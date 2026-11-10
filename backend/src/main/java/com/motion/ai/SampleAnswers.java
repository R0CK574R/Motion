package com.motion.ai;

import com.fasterxml.jackson.databind.JsonNode;
import com.motion.ai.AiTools.ToolException;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import org.springframework.stereotype.Component;

/**
 * Answers for demo accounts that are produced WITHOUT calling the model.
 *
 * Anyone can open the demo, so letting it reach the paid AI API would let
 * strangers spend the owner's money. Unless a demo budget is configured, the
 * demo instead answers a fixed set of questions with sentences filled in from
 * the same tools the model would have used. The numbers are real; the wording
 * is a template. The API marks these responses `sample: true` and the UI says
 * so.
 */
@Component
public class SampleAnswers {

  public static final List<String> QUESTIONS =
      List.of(
          "What is my largest position?",
          "How concentrated is my portfolio?",
          "What is my value at risk?",
          "What would a repeat of 2008 do to my portfolio?");

  public record Answer(String text, List<String> tools) {}

  public record Memo(String title, List<AiService.MemoSection> sections, List<String> tools) {}

  private static final String RISK_OFFLINE =
      "The risk engine is offline right now, so risk figures aren't available.";

  private final AiTools tools;

  public SampleAnswers(AiTools tools) {
    this.tools = tools;
  }

  public Answer ask(UUID userId, String question) {
    String q = question.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9 ]", "").trim();
    for (int i = 0; i < QUESTIONS.size(); i++) {
      String known = QUESTIONS.get(i).toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9 ]", "").trim();
      if (known.equals(q)) {
        return switch (i) {
          case 0 -> largest(userId);
          case 1 -> concentration(userId);
          case 2 -> valueAtRisk(userId);
          default -> crash2008(userId);
        };
      }
    }
    return new Answer(
        "This demo answers a fixed set of sample questions from your portfolio data, without "
            + "calling the AI model. Pick one of the suggested questions. With an account and a "
            + "subscription, you can ask anything about your portfolio in your own words.",
        List.of());
  }

  private Answer largest(UUID userId) {
    JsonNode p = tools.portfolio(userId);
    JsonNode top = p.path("positions").path(0);
    if (top.isMissingNode()) {
      return new Answer("There are no positions in this portfolio yet.", List.of(AiTools.GET_PORTFOLIO));
    }
    return new Answer(
        "Your largest position is " + top.path("ticker").asText() + ", worth " + usd(top.path("value"))
            + ", which is " + pct(top.path("weight_pct")) + " of the portfolio's total value of "
            + usd(p.path("total_value")) + ". It is up " + pct(top.path("unrealized_gain_pct"))
            + " on its cost.",
        List.of(AiTools.GET_PORTFOLIO));
  }

  private Answer concentration(UUID userId) {
    JsonNode p = tools.portfolio(userId);
    StringBuilder text =
        new StringBuilder("Your three largest positions make up ")
            .append(pct(p.path("top3_positions_pct")))
            .append(" of the portfolio, across ")
            .append(p.path("position_count").asInt())
            .append(" positions in total. Cash is ")
            .append(pct(p.path("cash_pct")))
            .append(".");
    List<String> used = new ArrayList<>(List.of(AiTools.GET_PORTFOLIO));
    try {
      JsonNode top = tools.risk(userId, p.path("none")).path("risk_contributions").path(0);
      if (!top.isMissingNode()) {
        text.append(" By risk, ")
            .append(top.path("ticker").asText())
            .append(" contributes the most: ")
            .append(pct(top.path("share_of_risk_pct")))
            .append(" of the portfolio's risk against ")
            .append(pct(top.path("weight_pct")))
            .append(" of its value, according to an illustrative model.");
        used.add(AiTools.GET_RISK);
      }
    } catch (ToolException | com.motion.common.ApiException e) {
      // Risk is a bonus here; the concentration figures stand on their own.
    }
    return new Answer(text.toString(), used);
  }

  private Answer valueAtRisk(UUID userId) {
    try {
      JsonNode r = tools.risk(userId, tools.portfolio(userId).path("none"));
      return new Answer(
          "Over " + r.path("horizon_days").asInt() + " trading day, the model expects the portfolio's "
              + "loss to stay within " + usd(r.path("value_at_risk")) + " (" + pct(r.path("value_at_risk_pct"))
              + ") with " + plain(r.path("confidence_pct")) + "% confidence. In the cases worse than "
              + "that, the average loss is " + usd(r.path("expected_shortfall"))
              + ". These figures come from an illustrative model, not live market data.",
          List.of(AiTools.GET_RISK));
    } catch (ToolException | com.motion.common.ApiException e) {
      return new Answer(RISK_OFFLINE, List.of());
    }
  }

  private Answer crash2008(UUID userId) {
    try {
      for (JsonNode s : tools.stressTests(userId).path("scenarios")) {
        if (s.path("scenario").asText().contains("2008")) {
          JsonNode worst = s.path("largest_position_changes").path(0);
          return new Answer(
              "If the 2008 financial crisis repeated, the model estimates this portfolio would change by "
                  + usd(s.path("portfolio_change")) + " (" + pct(s.path("portfolio_change_pct"))
                  + ") from peak to trough. The largest single change would be in "
                  + worst.path("ticker").asText() + ", at " + usd(worst.path("change"))
                  + ". This is an illustrative estimate, not a prediction.",
              List.of(AiTools.GET_STRESS_TESTS));
        }
      }
    } catch (ToolException | com.motion.common.ApiException e) {
      // fall through
    }
    return new Answer(RISK_OFFLINE, List.of());
  }

  public Memo memo(UUID userId) {
    List<AiService.MemoSection> sections = new ArrayList<>();
    List<String> used = new ArrayList<>(List.of(AiTools.GET_PORTFOLIO));
    JsonNode p = tools.portfolio(userId);
    sections.add(
        new AiService.MemoSection(
            "Overview",
            "The portfolio is worth " + usd(p.path("total_value")) + " across "
                + p.path("position_count").asInt() + " positions, with " + usd(p.path("cash"))
                + " (" + pct(p.path("cash_pct")) + ") in cash. Unrealised gains stand at "
                + usd(p.path("unrealized_gain")) + ", or " + pct(p.path("unrealized_gain_pct"))
                + " on cost."));
    sections.add(new AiService.MemoSection("Concentration", concentration(userId).text()));
    Answer var = valueAtRisk(userId);
    sections.add(new AiService.MemoSection("Risk", var.text()));
    sections.add(new AiService.MemoSection("Stress test", crash2008(userId).text()));
    if (!var.tools().isEmpty()) {
      used.add(AiTools.GET_RISK);
      used.add(AiTools.GET_STRESS_TESTS);
    }
    sections.add(
        new AiService.MemoSection(
            "Limitations",
            "Prices are the last trade or user-entered, not live market data. Risk figures assume "
                + "normally distributed returns, which understates extreme losses. Nothing here is "
                + "investment advice."));
    return new Memo("Portfolio risk memo", sections, used);
  }

  // ------------------------------------------------------------- formatting

  private static String usd(JsonNode amount) {
    BigDecimal value = amount.decimalValue();
    return (value.signum() < 0 ? "-$" : "$") + String.format(Locale.US, "%,.2f", value.abs());
  }

  private static String pct(JsonNode percent) {
    return plain(percent) + "%";
  }

  private static String plain(JsonNode number) {
    return number.decimalValue().toPlainString();
  }
}
