package com.motion.ledger;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.motion.audit.AuditService;
import com.motion.common.ApiException;
import com.motion.ledger.LedgerRepository.TransactionRow;
import com.motion.ledger.LedgerRules.Entry;
import com.motion.ledger.LedgerRules.Normalized;
import com.motion.ledger.LedgerRules.Position;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Posts transactions to the ledger and reads them back.
 *
 * Every posting follows the same steps inside one database transaction:
 * lock the portfolio, read the current balances, let {@link LedgerRules}
 * decide the entries, write them. If any step fails, nothing is written.
 */
@Service
public class LedgerService {

  @JsonInclude(JsonInclude.Include.NON_NULL)
  public record EntryView(
      Account account, String ticker, BigDecimal debit, BigDecimal credit, BigDecimal quantity) {

    static EntryView of(Entry e) {
      return new EntryView(
          e.account(),
          e.ticker(),
          e.amount().signum() > 0 ? e.amount() : null,
          e.amount().signum() < 0 ? e.amount().negate() : null,
          e.quantity().signum() == 0 ? null : e.quantity());
    }
  }

  @JsonInclude(JsonInclude.Include.NON_NULL)
  public record TransactionView(
      UUID id,
      long seq,
      TransactionType type,
      String ticker,
      BigDecimal quantity,
      BigDecimal price,
      BigDecimal amount,
      String memo,
      Instant createdAt,
      UUID reversesId,
      boolean reversed,
      boolean reversible,
      List<EntryView> entries) {}

  /** {@code replayed} is true when an idempotency key matched an earlier posting. */
  public record PostResult(TransactionView transaction, boolean replayed) {}

  public record TrialBalance(Map<Account, BigDecimal> accounts, BigDecimal total, boolean balanced) {}

  private static final int MAX_KEY_LENGTH = 100;

  private final LedgerRepository repo;
  private final AuditService audit;

  public LedgerService(LedgerRepository repo, AuditService audit) {
    this.repo = repo;
    this.audit = audit;
  }

  @Transactional
  public PostResult post(UUID userId, PostTransactionRequest request, String idempotencyKey) {
    return post(userId, request, idempotencyKey, true);
  }

  /**
   * @param idempotencyKey optional client-chosen key. Sending the same key
   *     again returns the first result instead of posting a second time, so a
   *     client that timed out can retry safely.
   * @param audited false only for system-generated seed data
   */
  @Transactional
  public PostResult post(
      UUID userId, PostTransactionRequest request, String idempotencyKey, boolean audited) {
    Normalized tx = LedgerRules.normalize(request);
    String key = normalizeKey(idempotencyKey);
    UUID portfolioId = repo.lockPortfolio(userId);

    if (key != null) {
      Optional<TransactionRow> earlier = repo.findByIdempotencyKey(portfolioId, key);
      if (earlier.isPresent()) {
        if (!sameRequest(earlier.get(), tx)) {
          throw new ApiException(
              HttpStatus.CONFLICT,
              "This Idempotency-Key was already used for a different transaction.",
              "IDEMPOTENCY_KEY_REUSED");
        }
        return new PostResult(view(portfolioId, earlier.get()), true);
      }
    }

    BigDecimal cash = repo.cash(portfolioId);
    Position position =
        tx.type().isTrade() ? repo.position(portfolioId, tx.ticker()) : Position.NONE;
    List<Entry> entries = LedgerRules.entriesFor(tx, cash, position);

    TransactionRow row = repo.insertTransaction(portfolioId, tx, tx.type(), key, null);
    repo.insertEntries(row.id(), portfolioId, entries);
    if (tx.type().isTrade()) {
      repo.upsertPrice(portfolioId, tx.ticker(), tx.price()); // the trade is the latest price seen
    }
    if (audited) {
      audit.record(userId, "LEDGER_POST", describe(row));
    }
    return new PostResult(toView(row, entries, true), false);
  }

  /**
   * Undoes a transaction by posting its mirror image. The original stays in
   * the journal untouched; history shows both.
   */
  @Transactional
  public TransactionView reverse(UUID userId, UUID transactionId) {
    UUID portfolioId = repo.lockPortfolio(userId);
    TransactionRow original =
        repo.findTransaction(portfolioId, transactionId)
            .orElseThrow(() -> ApiException.notFound("Transaction not found."));

    if (original.type() == TransactionType.REVERSAL) {
      throw ApiException.badRequest("A reversal cannot itself be reversed.");
    }
    if (original.reversed()) {
      throw new ApiException(
          HttpStatus.CONFLICT, "This transaction has already been reversed.", "ALREADY_REVERSED");
    }
    if (original.ticker() != null) {
      Long latest = repo.latestTradePerTicker(portfolioId).get(original.ticker());
      if (latest == null || latest != original.seq()) {
        throw ApiException.unprocessable(
            "Only the most recent trade in " + original.ticker() + " can be reversed. "
                + "To undo an older one, record an offsetting trade.",
            "NOT_LATEST_TRADE");
      }
    }

    List<Entry> entries =
        LedgerRules.reverse(repo.entriesFor(List.of(original.id())).getOrDefault(original.id(), List.of()));

    BigDecimal cashAfter = repo.cash(portfolioId);
    BigDecimal sharesAfter =
        original.ticker() == null
            ? BigDecimal.ZERO
            : repo.position(portfolioId, original.ticker()).quantity();
    for (Entry e : entries) {
      if (e.account() == Account.CASH) {
        cashAfter = cashAfter.add(e.amount());
      }
      sharesAfter = sharesAfter.add(e.quantity());
    }
    if (cashAfter.signum() < 0) {
      throw ApiException.unprocessable(
          "Reversing this would take cash below zero, because the money has since been used.",
          "INSUFFICIENT_CASH");
    }
    if (sharesAfter.signum() < 0) {
      throw ApiException.unprocessable(
          "Reversing this would leave a negative share count.", "INSUFFICIENT_SHARES");
    }

    Normalized mirror =
        new Normalized(
            TransactionType.REVERSAL,
            original.ticker(),
            original.quantity(),
            original.price(),
            original.amount(),
            "Reversal of " + original.type().name().toLowerCase());
    TransactionRow row =
        repo.insertTransaction(portfolioId, mirror, TransactionType.REVERSAL, null, original.id());
    repo.insertEntries(row.id(), portfolioId, entries);

    Map<String, Object> detail = describe(row);
    detail.put("reverses", original.id().toString());
    audit.record(userId, "LEDGER_REVERSE", detail);
    return toView(row, entries, false);
  }

  /**
   * Records the latest known price of a ticker the user holds. Prices are
   * market data, not money movements, so they sit outside the journal.
   */
  @Transactional
  public void setPrice(UUID userId, String rawTicker, BigDecimal price, boolean audited) {
    String ticker = rawTicker == null ? "" : rawTicker.trim().toUpperCase();
    if (price == null || price.signum() < 0 || price.compareTo(new BigDecimal("10000000")) > 0) {
      throw ApiException.badRequest("price must be zero or more.");
    }
    if (price.stripTrailingZeros().scale() > LedgerRules.PRICE_SCALE) {
      throw ApiException.badRequest(
          "price can have at most " + LedgerRules.PRICE_SCALE + " decimal places.");
    }
    UUID portfolioId = repo.lockPortfolio(userId);
    if (repo.position(portfolioId, ticker).quantity().signum() <= 0) {
      throw ApiException.notFound("You do not hold " + ticker + ".");
    }
    repo.upsertPrice(portfolioId, ticker, price);
    if (audited) {
      audit.record(userId, "PRICE_UPDATE", Map.of("ticker", ticker, "price", price.toPlainString()));
    }
  }

  @Transactional(readOnly = true)
  public List<TransactionView> recent(UUID userId, int limit) {
    Optional<UUID> portfolioId = repo.findPortfolio(userId);
    if (portfolioId.isEmpty()) {
      return List.of();
    }
    List<TransactionRow> rows = repo.recentTransactions(portfolioId.get(), limit);
    Map<UUID, List<Entry>> entries = repo.entriesFor(rows.stream().map(TransactionRow::id).toList());
    Map<String, Long> latest = repo.latestTradePerTicker(portfolioId.get());
    return rows.stream()
        .map(r -> toView(r, entries.getOrDefault(r.id(), List.of()), reversible(r, latest)))
        .toList();
  }

  /** Per-account totals. In a correct double-entry ledger they always sum to zero. */
  @Transactional(readOnly = true)
  public TrialBalance trialBalance(UUID userId) {
    Map<Account, BigDecimal> accounts =
        repo.findPortfolio(userId).map(repo::balances).orElseGet(() -> repo.balances(new UUID(0, 0)));
    BigDecimal total = accounts.values().stream().reduce(BigDecimal.ZERO, BigDecimal::add);
    return new TrialBalance(accounts, total, total.signum() == 0);
  }

  // ----------------------------------------------------------------- helpers

  private TransactionView view(UUID portfolioId, TransactionRow row) {
    List<Entry> entries = repo.entriesFor(List.of(row.id())).getOrDefault(row.id(), List.of());
    return toView(row, entries, reversible(row, repo.latestTradePerTicker(portfolioId)));
  }

  private static boolean reversible(TransactionRow row, Map<String, Long> latestTradePerTicker) {
    if (row.type() == TransactionType.REVERSAL || row.reversed()) {
      return false;
    }
    if (row.ticker() == null) {
      return true;
    }
    Long latest = latestTradePerTicker.get(row.ticker());
    return latest != null && latest == row.seq();
  }

  private static TransactionView toView(TransactionRow row, List<Entry> entries, boolean reversible) {
    return new TransactionView(
        row.id(),
        row.seq(),
        row.type(),
        row.ticker(),
        row.quantity(),
        row.price(),
        row.amount(),
        row.memo(),
        row.createdAt(),
        row.reversesId(),
        row.reversed(),
        reversible,
        entries.stream().map(EntryView::of).toList());
  }

  private static Map<String, Object> describe(TransactionRow row) {
    Map<String, Object> detail = new LinkedHashMap<>();
    detail.put("transactionId", row.id().toString());
    detail.put("type", row.type().name());
    if (row.ticker() != null) {
      detail.put("ticker", row.ticker());
      detail.put("quantity", row.quantity().toPlainString());
      detail.put("price", row.price().toPlainString());
    }
    detail.put("amount", row.amount().toPlainString());
    return detail;
  }

  private static boolean sameRequest(TransactionRow earlier, Normalized tx) {
    return earlier.type() == tx.type()
        && Objects.equals(earlier.ticker(), tx.ticker())
        && sameNumber(earlier.quantity(), tx.quantity())
        && sameNumber(earlier.price(), tx.price())
        && sameNumber(earlier.amount(), tx.amount());
  }

  private static boolean sameNumber(BigDecimal a, BigDecimal b) {
    return a == null ? b == null : b != null && a.compareTo(b) == 0;
  }

  private static String normalizeKey(String key) {
    if (key == null || key.isBlank()) {
      return null;
    }
    String trimmed = key.trim();
    if (trimmed.length() > MAX_KEY_LENGTH) {
      throw ApiException.badRequest(
          "Idempotency-Key must be " + MAX_KEY_LENGTH + " characters or fewer.");
    }
    return trimmed;
  }
}
