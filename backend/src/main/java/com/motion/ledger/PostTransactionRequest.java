package com.motion.ledger;

import java.math.BigDecimal;

/**
 * Body of POST /api/ledger/transactions.
 *
 * <ul>
 *   <li>DEPOSIT, WITHDRAWAL: {@code amount} is required.
 *   <li>BUY, SELL: {@code ticker}, {@code quantity} and {@code price} are
 *       required; the cash amount is computed as quantity x price.
 * </ul>
 */
public record PostTransactionRequest(
    TransactionType type,
    String ticker,
    BigDecimal quantity,
    BigDecimal price,
    BigDecimal amount,
    String memo) {

  public static PostTransactionRequest deposit(String amount) {
    return new PostTransactionRequest(
        TransactionType.DEPOSIT, null, null, null, new BigDecimal(amount), null);
  }

  public static PostTransactionRequest withdrawal(String amount) {
    return new PostTransactionRequest(
        TransactionType.WITHDRAWAL, null, null, null, new BigDecimal(amount), null);
  }

  public static PostTransactionRequest buy(String ticker, String quantity, String price) {
    return new PostTransactionRequest(
        TransactionType.BUY, ticker, new BigDecimal(quantity), new BigDecimal(price), null, null);
  }

  public static PostTransactionRequest sell(String ticker, String quantity, String price) {
    return new PostTransactionRequest(
        TransactionType.SELL, ticker, new BigDecimal(quantity), new BigDecimal(price), null, null);
  }
}
