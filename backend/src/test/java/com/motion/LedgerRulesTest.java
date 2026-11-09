package com.motion;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.motion.common.ApiException;
import com.motion.ledger.Account;
import com.motion.ledger.LedgerRules;
import com.motion.ledger.LedgerRules.Entry;
import com.motion.ledger.LedgerRules.Normalized;
import com.motion.ledger.LedgerRules.Position;
import com.motion.ledger.PostTransactionRequest;
import com.motion.ledger.TransactionType;
import java.math.BigDecimal;
import java.util.List;
import org.junit.jupiter.api.Test;

/** The bookkeeping rules on their own: no database, no Spring. */
class LedgerRulesTest {

  private static BigDecimal bd(String value) {
    return new BigDecimal(value);
  }

  private static Entry entry(List<Entry> entries, Account account) {
    return entries.stream().filter(e -> e.account() == account).findFirst().orElseThrow();
  }

  private static void assertBalanced(List<Entry> entries) {
    assertThat(LedgerRules.sum(entries)).isEqualByComparingTo("0");
  }

  @Test
  void depositDebitsCashAndCreditsContributions() {
    Normalized tx = LedgerRules.normalize(PostTransactionRequest.deposit("1000"));
    List<Entry> entries = LedgerRules.entriesFor(tx, bd("0"), Position.NONE);

    assertThat(entries).hasSize(2);
    assertThat(entry(entries, Account.CASH).amount()).isEqualByComparingTo("1000.00");
    assertThat(entry(entries, Account.CONTRIBUTIONS).amount()).isEqualByComparingTo("-1000.00");
    assertBalanced(entries);
  }

  @Test
  void withdrawalNeedsEnoughCash() {
    Normalized tx = LedgerRules.normalize(PostTransactionRequest.withdrawal("500"));

    List<Entry> entries = LedgerRules.entriesFor(tx, bd("500.00"), Position.NONE);
    assertThat(entry(entries, Account.CASH).amount()).isEqualByComparingTo("-500");
    assertBalanced(entries);

    assertThatThrownBy(() -> LedgerRules.entriesFor(tx, bd("499.99"), Position.NONE))
        .isInstanceOf(ApiException.class)
        .extracting(e -> ((ApiException) e).code())
        .isEqualTo("INSUFFICIENT_CASH");
  }

  @Test
  void buyMovesCashIntoSecuritiesAtCost() {
    Normalized tx = LedgerRules.normalize(PostTransactionRequest.buy(" aapl ", "10", "150.25"));
    assertThat(tx.ticker()).isEqualTo("AAPL");
    assertThat(tx.amount()).isEqualByComparingTo("1502.50");

    List<Entry> entries = LedgerRules.entriesFor(tx, bd("2000"), Position.NONE);
    Entry securities = entry(entries, Account.SECURITIES);
    assertThat(securities.amount()).isEqualByComparingTo("1502.50");
    assertThat(securities.quantity()).isEqualByComparingTo("10");
    assertThat(securities.ticker()).isEqualTo("AAPL");
    assertThat(entry(entries, Account.CASH).amount()).isEqualByComparingTo("-1502.50");
    assertBalanced(entries);
  }

  @Test
  void buyIsRefusedWithoutEnoughCash() {
    Normalized tx = LedgerRules.normalize(PostTransactionRequest.buy("AAPL", "10", "150"));
    assertThatThrownBy(() -> LedgerRules.entriesFor(tx, bd("1499.99"), Position.NONE))
        .isInstanceOf(ApiException.class)
        .hasMessageContaining("Not enough cash");
  }

  @Test
  void sellBooksTheGainAgainstAverageCost() {
    // 20 shares that cost 3,200 in total: average cost 160.
    Position position = new Position(bd("20"), bd("3200.00"));
    Normalized tx = LedgerRules.normalize(PostTransactionRequest.sell("AAPL", "5", "200"));
    List<Entry> entries = LedgerRules.entriesFor(tx, bd("0"), position);

    assertThat(entry(entries, Account.CASH).amount()).isEqualByComparingTo("1000.00");
    Entry securities = entry(entries, Account.SECURITIES);
    assertThat(securities.amount()).isEqualByComparingTo("-800.00"); // 5 x 160 of cost leaves
    assertThat(securities.quantity()).isEqualByComparingTo("-5");
    assertThat(entry(entries, Account.REALIZED_PNL).amount()).isEqualByComparingTo("-200.00"); // credit = gain
    assertBalanced(entries);
  }

  @Test
  void sellAtALossDebitsRealizedPnl() {
    Position position = new Position(bd("10"), bd("1000.00"));
    Normalized tx = LedgerRules.normalize(PostTransactionRequest.sell("XYZ", "10", "70"));
    List<Entry> entries = LedgerRules.entriesFor(tx, bd("0"), position);

    assertThat(entry(entries, Account.REALIZED_PNL).amount()).isEqualByComparingTo("300.00");
    assertBalanced(entries);
  }

  @Test
  void sellingEverythingRemovesTheWholeBasis() {
    // 3 shares that cost 100.00: a third of the cost is 33.33, which would
    // leave a cent behind if the last sale were prorated.
    Position position = new Position(bd("3"), bd("100.00"));
    Normalized partial = LedgerRules.normalize(PostTransactionRequest.sell("XYZ", "1", "40"));
    assertThat(entry(LedgerRules.entriesFor(partial, bd("0"), position), Account.SECURITIES).amount())
        .isEqualByComparingTo("-33.33");

    Normalized all = LedgerRules.normalize(PostTransactionRequest.sell("XYZ", "3", "40"));
    List<Entry> entries = LedgerRules.entriesFor(all, bd("0"), position);
    assertThat(entry(entries, Account.SECURITIES).amount()).isEqualByComparingTo("-100.00");
    assertBalanced(entries);
  }

  @Test
  void sellAtCostWritesNoPnlEntry() {
    Position position = new Position(bd("10"), bd("1000.00"));
    Normalized tx = LedgerRules.normalize(PostTransactionRequest.sell("XYZ", "4", "100"));
    List<Entry> entries = LedgerRules.entriesFor(tx, bd("0"), position);
    assertThat(entries).hasSize(2);
    assertBalanced(entries);
  }

  @Test
  void cannotSellMoreThanIsHeld() {
    Position position = new Position(bd("5"), bd("500.00"));
    Normalized tx = LedgerRules.normalize(PostTransactionRequest.sell("XYZ", "5.000001", "100"));
    assertThatThrownBy(() -> LedgerRules.entriesFor(tx, bd("0"), position))
        .isInstanceOf(ApiException.class)
        .extracting(e -> ((ApiException) e).code())
        .isEqualTo("INSUFFICIENT_SHARES");
  }

  @Test
  void reversalMirrorsEveryEntry() {
    Position position = new Position(bd("20"), bd("3200.00"));
    Normalized tx = LedgerRules.normalize(PostTransactionRequest.sell("AAPL", "5", "200"));
    List<Entry> original = LedgerRules.entriesFor(tx, bd("0"), position);
    List<Entry> mirror = LedgerRules.reverse(original);

    assertThat(mirror).hasSameSizeAs(original);
    for (int i = 0; i < original.size(); i++) {
      assertThat(mirror.get(i).amount().add(original.get(i).amount())).isEqualByComparingTo("0");
      assertThat(mirror.get(i).quantity().add(original.get(i).quantity())).isEqualByComparingTo("0");
    }
    assertBalanced(mirror);
  }

  @Test
  void amountsRoundHalfToEven() {
    assertThat(LedgerRules.money(bd("0.125"))).isEqualByComparingTo("0.12");
    assertThat(LedgerRules.money(bd("0.135"))).isEqualByComparingTo("0.14");
    // 3 shares at 0.335 = 1.005, which rounds to the even cent, 1.00.
    assertThat(LedgerRules.normalize(PostTransactionRequest.buy("X", "3", "0.335")).amount())
        .isEqualByComparingTo("1.00");
  }

  @Test
  void rejectsInvalidRequests() {
    assertInvalid(null);
    assertInvalid(new PostTransactionRequest(null, null, null, null, bd("5"), null));
    assertInvalid(new PostTransactionRequest(TransactionType.REVERSAL, null, null, null, bd("5"), null));
    assertInvalid(PostTransactionRequest.deposit("0"));
    assertInvalid(PostTransactionRequest.deposit("-5"));
    assertInvalid(PostTransactionRequest.deposit("10.001")); // more precise than a cent
    assertInvalid(PostTransactionRequest.deposit("1000000000001"));
    assertInvalid(new PostTransactionRequest(TransactionType.DEPOSIT, null, null, null, null, null));
    assertInvalid(PostTransactionRequest.buy("", "1", "1"));
    assertInvalid(PostTransactionRequest.buy("TOO-LONG-TICKER", "1", "1"));
    assertInvalid(PostTransactionRequest.buy("AA PL", "1", "1"));
    assertInvalid(PostTransactionRequest.buy("AAPL", "0", "1"));
    assertInvalid(PostTransactionRequest.buy("AAPL", "1.0000001", "1"));
    assertInvalid(PostTransactionRequest.buy("AAPL", "1", "1.00001"));
    assertInvalid(PostTransactionRequest.buy("AAPL", "0.000001", "0.0001")); // worth under a cent
    assertInvalid(
        new PostTransactionRequest(TransactionType.DEPOSIT, null, null, null, bd("5"), "x".repeat(201)));
  }

  @Test
  void acceptsTrailingZerosAndDottedTickers() {
    Normalized tx = LedgerRules.normalize(PostTransactionRequest.buy("brk.b", "1.5000000", "400.10000"));
    assertThat(tx.ticker()).isEqualTo("BRK.B");
    assertThat(tx.quantity()).isEqualByComparingTo("1.5");
    assertThat(tx.amount()).isEqualByComparingTo("600.15");
  }

  private static void assertInvalid(PostTransactionRequest request) {
    assertThatThrownBy(() -> LedgerRules.normalize(request))
        .isInstanceOf(ApiException.class)
        .extracting(e -> ((ApiException) e).status().value())
        .isEqualTo(400);
  }
}
