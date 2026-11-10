package com.motion;

import static org.assertj.core.api.Assertions.assertThat;

import com.motion.ai.AdviceGuard;
import com.motion.ai.GroundingVerifier;
import java.util.List;
import org.junit.jupiter.api.Test;

/** The two checks every model-written answer passes through. Pure logic, no Spring. */
class AiGuardsTest {

  private static final String EVIDENCE =
      "{\"total_value\":69065.00,\"cash\":6500.00,\"cash_pct\":9.4,"
          + "\"positions\":[{\"ticker\":\"VOO\",\"value\":13625.00,\"weight_pct\":19.7}],"
          + "\"value_at_risk\":1244.70,\"annual_volatility_pct\":17.5,\"portfolio_change\":-39295.12,"
          + "\"description\":\"Oct 2007 to Mar 2009: US equities roughly -57%\","
          + "\"confidence_pct\":95,\"horizon_days\":1,\"date\":\"2026-11-09\"}";

  private static void assertGrounded(String answer, String... extraEvidence) {
    List<String> evidence = new java.util.ArrayList<>(List.of(EVIDENCE));
    evidence.addAll(List.of(extraEvidence));
    GroundingVerifier.Result result = GroundingVerifier.verify(answer, evidence);
    assertThat(result.ungrounded()).as(answer).isEmpty();
    assertThat(result.grounded()).isTrue();
  }

  private static void assertUngrounded(String answer, String... figures) {
    GroundingVerifier.Result result = GroundingVerifier.verify(answer, List.of(EVIDENCE));
    assertThat(result.grounded()).as(answer).isFalse();
    assertThat(result.ungrounded()).containsExactly(figures);
  }

  @Test
  void figuresQuotedFromTheDataAreGrounded() {
    assertGrounded("Your largest position is VOO at 19.7% of the portfolio, worth $13,625.00.");
    assertGrounded("Total value is $69,065.00, of which cash is 9.4%.");
    assertGrounded("It was recorded on 2026-11-09.");
  }

  @Test
  void roundingToFewerDecimalsIsAccepted() {
    assertGrounded("VOO is worth $13,625 and cash is $6,500.");
    assertGrounded("The 1-day 95% value at risk is $1,244.70, or about $1,245.");
    assertGrounded("Volatility is about 18% a year.");
  }

  @Test
  void signsAndTextualFiguresAreHandled() {
    assertGrounded("A repeat of 2008 would lose $39,295, as equities fell roughly 57% from 2007 to 2009.",
        "What about 2008?");
    assertGrounded("Losses could reach −$39,295.12.");
  }

  @Test
  void figuresFromTheQuestionCountAsEvidence() {
    assertGrounded("You asked about $250; that ticker is not held.", "Is $250 a lot?");
  }

  @Test
  void smallCountsAndWordsWithDigitsAreNotTreatedAsFigures() {
    assertGrounded("You hold 7 positions; the top 3 are large.");
    assertGrounded("During COVID-19 markets fell.");
    assertGrounded("There are no figures in this sentence.");
  }

  @Test
  void inventedFiguresAreCaught() {
    assertUngrounded("VOO is worth $14,000.", "$14,000");
    assertUngrounded("Your value at risk is $1,300.", "$1,300");
    assertUngrounded("Cash is 9.5% of the portfolio.", "9.5%");
    assertUngrounded("The portfolio returned 12.3% last year.", "12.3%");
    assertUngrounded("VOO tracks roughly 500 companies.", "500");
  }

  @Test
  void falsePrecisionIsCaught() {
    // The data says 69065.00; an answer cannot claim a third decimal place.
    assertUngrounded("Total is $69,065.004.", "$69,065.004");
  }

  @Test
  void everyUngroundedFigureIsReported() {
    assertUngrounded("VOO is $13,625, but $2 and 55% are made up.", "$2", "55%");
  }

  @Test
  void knownLimitNumbersAreMatchedWithoutTheirUnits() {
    // The check compares numbers, not what they measure. The evidence holds a
    // horizon of 1 day, so "$1" is accepted although no dollar amount is 1.
    // It catches invented figures, not a real figure attached to the wrong thing.
    assertGrounded("That is $1.");
  }

  @Test
  void adviceIsDetected() {
    for (String advice :
        List.of(
            "You should sell your Nvidia shares.",
            "I recommend trimming the technology positions.",
            "I'd suggest holding more cash.",
            "Consider diversifying into bonds.",
            "You might want to reduce your AAPL position.",
            "Now is a good time to buy more VOO.",
            "NVDA is a strong buy.",
            "The stock will likely rise next quarter.",
            "My recommendation is to rebalance.",
            "You need to add international exposure.")) {
      assertThat(AdviceGuard.containsAdvice(advice)).as(advice).isTrue();
    }
  }

  @Test
  void descriptionsRefusalsAndDisclaimersAreNotAdvice() {
    for (String fine :
        List.of(
            "Technology makes up 45.1% of the portfolio, which is a high concentration.",
            "I can't tell you whether to buy or sell; here are the figures.",
            "This is not a recommendation to buy or sell any security.",
            "Motion doesn't give investment advice.",
            "You bought 10 shares and later sold 5.",
            "The 2008 scenario would reduce the portfolio by 56.9%.",
            "Selling 5 shares realised a gain of $200.00.",
            "If markets fall 34%, the portfolio would lose $23,689.",
            "I can't recommend any trades.",
            AdviceGuard.DECLINED)) {
      assertThat(AdviceGuard.containsAdvice(fine)).as(fine).isFalse();
    }
    assertThat(AdviceGuard.containsAdvice(null)).isFalse();
  }
}
