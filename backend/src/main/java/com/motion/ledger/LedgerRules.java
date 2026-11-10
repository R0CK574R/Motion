package com.motion.ledger;

import com.motion.common.ApiException;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

/**
 * The bookkeeping rules, as pure functions with no database and no framework.
 * Given a request and the current balances, they decide which entries to
 * write. Keeping them pure makes every rule testable in isolation.
 *
 * Money is always BigDecimal, never double: 0.1 + 0.2 is not 0.3 in binary
 * floating point, and a ledger has to add up to the cent.
 */
public final class LedgerRules {

  public static final int MONEY_SCALE = 2;
  public static final int PRICE_SCALE = 4;
  public static final int QUANTITY_SCALE = 6;

  private static final BigDecimal MAX_AMOUNT = new BigDecimal("1000000000000"); // 1 trillion
  private static final BigDecimal MAX_QUANTITY = new BigDecimal("1000000000");
  private static final BigDecimal MAX_PRICE = new BigDecimal("10000000");
  private static final Pattern TICKER = Pattern.compile("^[A-Z0-9][A-Z0-9.\\-]{0,11}$");
  private static final int MAX_MEMO = 200;

  private LedgerRules() {}

  /** A request after validation: trimmed, upper-cased, and with the cash amount filled in. */
  public record Normalized(
      TransactionType type,
      String ticker,
      BigDecimal quantity,
      BigDecimal price,
      BigDecimal amount,
      String memo) {}

  /** Shares held in one ticker and what they cost in total. */
  public record Position(BigDecimal quantity, BigDecimal basis) {
    public static final Position NONE = new Position(BigDecimal.ZERO, BigDecimal.ZERO);
  }

  /** One line of a transaction. Positive amount = debit, negative = credit. */
  public record Entry(Account account, String ticker, BigDecimal amount, BigDecimal quantity) {

    static Entry cash(BigDecimal amount) {
      return new Entry(Account.CASH, null, amount, BigDecimal.ZERO);
    }

    static Entry of(Account account, BigDecimal amount) {
      return new Entry(account, null, amount, BigDecimal.ZERO);
    }

    static Entry securities(String ticker, BigDecimal amount, BigDecimal quantity) {
      return new Entry(Account.SECURITIES, ticker, amount, quantity);
    }
  }

  /** Rounds to whole cents using banker's rounding (half to even). */
  public static BigDecimal money(BigDecimal value) {
    return value.setScale(MONEY_SCALE, RoundingMode.HALF_EVEN);
  }

  // ------------------------------------------------------------ validation

  public static Normalized normalize(PostTransactionRequest request) {
    if (request == null || request.type() == null || request.type() == TransactionType.REVERSAL) {
      throw ApiException.badRequest("type must be one of DEPOSIT, WITHDRAWAL, BUY or SELL.");
    }
    String memo = request.memo() == null || request.memo().isBlank() ? null : request.memo().trim();
    if (memo != null && memo.length() > MAX_MEMO) {
      throw ApiException.badRequest("memo must be " + MAX_MEMO + " characters or fewer.");
    }

    if (!request.type().isTrade()) {
      BigDecimal amount = positive(request.amount(), "amount", MONEY_SCALE, MAX_AMOUNT);
      return new Normalized(request.type(), null, null, null, money(amount), memo);
    }

    String ticker = request.ticker() == null ? "" : request.ticker().trim().toUpperCase();
    if (!TICKER.matcher(ticker).matches()) {
      throw ApiException.badRequest("ticker must be 1 to 12 letters, digits, dots or dashes.");
    }
    BigDecimal quantity = positive(request.quantity(), "quantity", QUANTITY_SCALE, MAX_QUANTITY);
    BigDecimal price = positive(request.price(), "price", PRICE_SCALE, MAX_PRICE);
    BigDecimal amount = money(quantity.multiply(price));
    if (amount.signum() <= 0) {
      throw ApiException.badRequest("The trade is worth less than one cent.");
    }
    if (amount.compareTo(MAX_AMOUNT) > 0) {
      throw ApiException.badRequest("The trade is too large.");
    }
    return new Normalized(
        request.type(),
        ticker,
        quantity.setScale(QUANTITY_SCALE, RoundingMode.UNNECESSARY),
        price.setScale(PRICE_SCALE, RoundingMode.UNNECESSARY),
        amount,
        memo);
  }

  /**
   * Requires a positive number with no more decimal places than the column
   * can hold. Extra precision is rejected rather than silently rounded, so
   * what the client sent is exactly what gets recorded.
   */
  private static BigDecimal positive(BigDecimal value, String field, int maxScale, BigDecimal max) {
    if (value == null || value.signum() <= 0) {
      throw ApiException.badRequest(field + " must be greater than zero.");
    }
    if (value.stripTrailingZeros().scale() > maxScale) {
      throw ApiException.badRequest(field + " can have at most " + maxScale + " decimal places.");
    }
    if (value.compareTo(max) > 0) {
      throw ApiException.badRequest(field + " is too large.");
    }
    return value;
  }

  // ---------------------------------------------------------------- entries

  /**
   * The entries for one transaction. They always sum to zero.
   *
   * @param cash current cash balance
   * @param position current holding in the request's ticker (ignored for cash movements)
   */
  public static List<Entry> entriesFor(Normalized tx, BigDecimal cash, Position position) {
    BigDecimal amount = tx.amount();
    List<Entry> entries = new ArrayList<>(3);
    switch (tx.type()) {
      case DEPOSIT -> {
        entries.add(Entry.cash(amount));
        entries.add(Entry.of(Account.CONTRIBUTIONS, amount.negate()));
      }
      case WITHDRAWAL -> {
        requireCash(cash, amount);
        entries.add(Entry.of(Account.CONTRIBUTIONS, amount));
        entries.add(Entry.cash(amount.negate()));
      }
      case BUY -> {
        requireCash(cash, amount);
        entries.add(Entry.securities(tx.ticker(), amount, tx.quantity()));
        entries.add(Entry.cash(amount.negate()));
      }
      case SELL -> {
        if (tx.quantity().compareTo(position.quantity()) > 0) {
          throw ApiException.unprocessable(
              "You hold " + position.quantity().stripTrailingZeros().toPlainString()
                  + " shares of " + tx.ticker() + ", which is fewer than this sale.",
              "INSUFFICIENT_SHARES");
        }
        // Average-cost method: the shares sold carry away their proportional
        // share of the total cost. Selling everything removes the whole
        // basis, so no rounding residue is left on an empty position.
        BigDecimal basisSold =
            tx.quantity().compareTo(position.quantity()) == 0
                ? position.basis()
                : money(
                    position.basis().multiply(tx.quantity())
                        .divide(position.quantity(), 10, RoundingMode.HALF_EVEN));
        BigDecimal gain = amount.subtract(basisSold);
        entries.add(Entry.cash(amount));
        entries.add(Entry.securities(tx.ticker(), basisSold.negate(), tx.quantity().negate()));
        if (gain.signum() != 0) {
          entries.add(Entry.of(Account.REALIZED_PNL, gain.negate())); // credit = gain
        }
      }
      case REVERSAL -> throw new IllegalArgumentException("reversals are built by reverse()");
    }
    return entries;
  }

  /** The mirror image of a transaction: every debit becomes a credit and back. */
  public static List<Entry> reverse(List<Entry> original) {
    return original.stream()
        .map(e -> new Entry(e.account(), e.ticker(), e.amount().negate(), e.quantity().negate()))
        .toList();
  }

  public static BigDecimal sum(List<Entry> entries) {
    return entries.stream().map(Entry::amount).reduce(BigDecimal.ZERO, BigDecimal::add);
  }

  private static void requireCash(BigDecimal cash, BigDecimal needed) {
    if (needed.compareTo(cash) > 0) {
      throw ApiException.unprocessable(
          "Not enough cash: this needs $" + needed.toPlainString() + " and the balance is $"
              + money(cash).toPlainString() + ".",
          "INSUFFICIENT_CASH");
    }
  }
}
