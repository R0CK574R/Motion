package com.motion.ledger;

import com.motion.ledger.LedgerRules.Entry;
import com.motion.ledger.LedgerRules.Normalized;
import com.motion.ledger.LedgerRules.Position;
import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.EnumMap;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/** All SQL that touches the ledger. Nothing here updates or deletes a ledger row. */
@Repository
public class LedgerRepository {

  public record TransactionRow(
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
      boolean reversed) {}

  public record HoldingRow(String ticker, BigDecimal quantity, BigDecimal basis, BigDecimal price) {}

  private static final String TRANSACTION_COLUMNS =
      """
      t.id, t.seq, t.type, t.ticker, t.quantity, t.price, t.amount, t.memo, t.created_at,
      t.reverses_id,
      EXISTS (SELECT 1 FROM ledger_transactions r WHERE r.reverses_id = t.id) AS reversed
      """;

  private final JdbcClient jdbc;

  public LedgerRepository(JdbcClient jdbc) {
    this.jdbc = jdbc;
  }

  // -------------------------------------------------------------- portfolio

  public Optional<UUID> findPortfolio(UUID userId) {
    return jdbc.sql("SELECT id FROM portfolios WHERE user_id = ?")
        .param(userId)
        .query((rs, i) -> rs.getObject(1, UUID.class))
        .optional();
  }

  /**
   * Returns the user's portfolio id and holds a row lock on it until the
   * surrounding transaction ends. Every posting takes this lock first, so two
   * postings to the same portfolio run one after the other. Without it, two
   * simultaneous sells could each see enough shares and together sell more
   * than exist.
   */
  public UUID lockPortfolio(UUID userId) {
    Optional<UUID> existing = selectForUpdate(userId);
    if (existing.isPresent()) {
      return existing.get();
    }
    jdbc.sql("INSERT INTO portfolios (user_id) VALUES (?) ON CONFLICT (user_id) DO NOTHING")
        .param(userId)
        .update();
    return selectForUpdate(userId).orElseThrow();
  }

  private Optional<UUID> selectForUpdate(UUID userId) {
    return jdbc.sql("SELECT id FROM portfolios WHERE user_id = ? FOR UPDATE")
        .param(userId)
        .query((rs, i) -> rs.getObject(1, UUID.class))
        .optional();
  }

  // --------------------------------------------------------------- balances

  /** Sum of every entry per account. An account with no entries is zero. */
  public Map<Account, BigDecimal> balances(UUID portfolioId) {
    Map<Account, BigDecimal> balances = new EnumMap<>(Account.class);
    for (Account account : Account.values()) {
      balances.put(account, BigDecimal.ZERO.setScale(LedgerRules.MONEY_SCALE));
    }
    jdbc.sql("SELECT account, SUM(amount) AS total FROM ledger_entries WHERE portfolio_id = ? GROUP BY account")
        .param(portfolioId)
        .query(
            (rs, i) -> {
              balances.put(Account.valueOf(rs.getString("account")), rs.getBigDecimal("total"));
              return i;
            })
        .list();
    return balances;
  }

  public BigDecimal cash(UUID portfolioId) {
    return balances(portfolioId).get(Account.CASH);
  }

  public Position position(UUID portfolioId, String ticker) {
    return jdbc.sql(
            """
            SELECT COALESCE(SUM(quantity), 0) AS quantity, COALESCE(SUM(amount), 0) AS basis
            FROM ledger_entries
            WHERE portfolio_id = ? AND account = 'SECURITIES' AND ticker = ?
            """)
        .params(portfolioId, ticker)
        .query((rs, i) -> new Position(rs.getBigDecimal("quantity"), rs.getBigDecimal("basis")))
        .single();
  }

  /** Current holdings: every ticker with shares left, with its latest known price. */
  public List<HoldingRow> holdings(UUID portfolioId) {
    return jdbc.sql(
            """
            SELECT e.ticker, SUM(e.quantity) AS quantity, SUM(e.amount) AS basis, m.price
            FROM ledger_entries e
            LEFT JOIN price_marks m ON m.portfolio_id = e.portfolio_id AND m.ticker = e.ticker
            WHERE e.portfolio_id = ? AND e.account = 'SECURITIES'
            GROUP BY e.ticker, m.price
            HAVING SUM(e.quantity) > 0
            ORDER BY e.ticker
            """)
        .param(portfolioId)
        .query(
            (rs, i) ->
                new HoldingRow(
                    rs.getString("ticker"),
                    rs.getBigDecimal("quantity"),
                    rs.getBigDecimal("basis"),
                    rs.getBigDecimal("price")))
        .list();
  }

  // ----------------------------------------------------------- transactions

  public TransactionRow insertTransaction(
      UUID portfolioId, Normalized tx, TransactionType type, String idempotencyKey, UUID reversesId) {
    return jdbc.sql(
            """
            INSERT INTO ledger_transactions
              (portfolio_id, type, ticker, quantity, price, amount, memo, idempotency_key, reverses_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            RETURNING id, seq, type, ticker, quantity, price, amount, memo, created_at,
                      reverses_id, false AS reversed
            """)
        .params(
            portfolioId,
            type.name(),
            tx.ticker(),
            tx.quantity(),
            tx.price(),
            tx.amount(),
            tx.memo(),
            idempotencyKey,
            reversesId)
        .query(LedgerRepository::mapTransaction)
        .single();
  }

  public void insertEntries(UUID transactionId, UUID portfolioId, List<Entry> entries) {
    for (Entry entry : entries) {
      jdbc.sql(
              """
              INSERT INTO ledger_entries (transaction_id, portfolio_id, account, ticker, amount, quantity)
              VALUES (?, ?, ?, ?, ?, ?)
              """)
          .params(
              transactionId,
              portfolioId,
              entry.account().name(),
              entry.ticker(),
              entry.amount(),
              entry.quantity())
          .update();
    }
  }

  public Optional<TransactionRow> findTransaction(UUID portfolioId, UUID transactionId) {
    return jdbc.sql(
            "SELECT " + TRANSACTION_COLUMNS
                + " FROM ledger_transactions t WHERE t.portfolio_id = ? AND t.id = ?")
        .params(portfolioId, transactionId)
        .query(LedgerRepository::mapTransaction)
        .optional();
  }

  public Optional<TransactionRow> findByIdempotencyKey(UUID portfolioId, String key) {
    return jdbc.sql(
            "SELECT " + TRANSACTION_COLUMNS
                + " FROM ledger_transactions t WHERE t.portfolio_id = ? AND t.idempotency_key = ?")
        .params(portfolioId, key)
        .query(LedgerRepository::mapTransaction)
        .optional();
  }

  public List<TransactionRow> recentTransactions(UUID portfolioId, int limit) {
    return jdbc.sql(
            "SELECT " + TRANSACTION_COLUMNS
                + " FROM ledger_transactions t WHERE t.portfolio_id = ? ORDER BY t.seq DESC LIMIT ?")
        .params(portfolioId, limit)
        .query(LedgerRepository::mapTransaction)
        .list();
  }

  /** Entries for a set of transactions, grouped by transaction id, in posting order. */
  public Map<UUID, List<Entry>> entriesFor(List<UUID> transactionIds) {
    Map<UUID, List<Entry>> byTransaction = new HashMap<>();
    if (transactionIds.isEmpty()) {
      return byTransaction;
    }
    jdbc.sql(
            """
            SELECT transaction_id, account, ticker, amount, quantity
            FROM ledger_entries WHERE transaction_id IN (:ids) ORDER BY id
            """)
        .param("ids", transactionIds)
        .query(
            (rs, i) -> {
              byTransaction
                  .computeIfAbsent(rs.getObject("transaction_id", UUID.class), k -> new java.util.ArrayList<>())
                  .add(
                      new Entry(
                          Account.valueOf(rs.getString("account")),
                          rs.getString("ticker"),
                          rs.getBigDecimal("amount"),
                          rs.getBigDecimal("quantity")));
              return i;
            })
        .list();
    return byTransaction;
  }

  /**
   * For each ticker, the sequence number of its latest trade that is still in
   * force (not a reversal and not itself reversed). Only that trade may be
   * reversed: undoing an older one would change the average cost that later
   * sales were booked at.
   */
  public Map<String, Long> latestTradePerTicker(UUID portfolioId) {
    Map<String, Long> latest = new HashMap<>();
    jdbc.sql(
            """
            SELECT t.ticker, MAX(t.seq) AS seq
            FROM ledger_transactions t
            WHERE t.portfolio_id = ? AND t.ticker IS NOT NULL AND t.type <> 'REVERSAL'
              AND NOT EXISTS (SELECT 1 FROM ledger_transactions r WHERE r.reverses_id = t.id)
            GROUP BY t.ticker
            """)
        .param(portfolioId)
        .query(
            (rs, i) -> {
              latest.put(rs.getString("ticker"), rs.getLong("seq"));
              return i;
            })
        .list();
    return latest;
  }

  // ------------------------------------------------------------ price marks

  public void upsertPrice(UUID portfolioId, String ticker, BigDecimal price) {
    jdbc.sql(
            """
            INSERT INTO price_marks (portfolio_id, ticker, price) VALUES (?, ?, ?)
            ON CONFLICT (portfolio_id, ticker)
            DO UPDATE SET price = EXCLUDED.price, updated_at = now()
            """)
        .params(portfolioId, ticker, price)
        .update();
  }

  private static TransactionRow mapTransaction(ResultSet rs, int row) throws SQLException {
    return new TransactionRow(
        rs.getObject("id", UUID.class),
        rs.getLong("seq"),
        TransactionType.valueOf(rs.getString("type")),
        rs.getString("ticker"),
        rs.getBigDecimal("quantity"),
        rs.getBigDecimal("price"),
        rs.getBigDecimal("amount"),
        rs.getString("memo"),
        rs.getTimestamp("created_at").toInstant(),
        rs.getObject("reverses_id", UUID.class),
        rs.getBoolean("reversed"));
  }
}
