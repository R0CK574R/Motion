package com.motion.ledger;

import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

/**
 * The portfolio every demo account starts with. It is built by posting real
 * ledger transactions (one deposit, then seven buys), so a demo visitor sees
 * a genuine journal, not rows inserted behind the ledger's back.
 *
 * The canned AI analysis in {@code analysis.DemoAnalysis} quotes numbers
 * from these exact holdings. Change one and you must change the other.
 */
public final class DemoPortfolio {

  public record Holding(String ticker, String shares, String cost, String price) {}

  public static final String CASH = "6500";

  public static final List<Holding> HOLDINGS =
      List.of(
          new Holding("VOO", "25", "398", "545"),
          new Holding("MSFT", "30", "305", "442"),
          new Holding("AAPL", "55", "152", "231"),
          new Holding("COST", "8", "520", "905"),
          new Holding("AMZN", "35", "130", "205"),
          new Holding("NVDA", "40", "48", "138"),
          new Holding("JNJ", "20", "158", "152"));

  private DemoPortfolio() {}

  /** Must be called inside a transaction. */
  public static void seed(LedgerService ledger, UUID userId) {
    BigDecimal deposit = new BigDecimal(CASH);
    for (Holding h : HOLDINGS) {
      deposit = deposit.add(new BigDecimal(h.shares()).multiply(new BigDecimal(h.cost())));
    }
    ledger.post(userId, PostTransactionRequest.deposit(deposit.toPlainString()), null, false);
    for (Holding h : HOLDINGS) {
      ledger.post(userId, PostTransactionRequest.buy(h.ticker(), h.shares(), h.cost()), null, false);
    }
    // Buying set each price mark to the purchase price; move them to today's.
    for (Holding h : HOLDINGS) {
      ledger.setPrice(userId, h.ticker(), new BigDecimal(h.price()), false);
    }
  }
}
