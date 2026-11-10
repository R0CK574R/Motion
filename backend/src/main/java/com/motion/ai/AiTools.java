package com.motion.ai;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.StreamWriteFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.motion.ai.ModelClient.ToolSpec;
import com.motion.common.ApiException;
import com.motion.ledger.LedgerService;
import com.motion.ledger.LedgerService.TransactionView;
import com.motion.portfolio.PortfolioService;
import com.motion.portfolio.PortfolioService.HoldingView;
import com.motion.portfolio.PortfolioService.PortfolioView;
import com.motion.risk.RiskEngineClient;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Component;

/**
 * The functions the model may call. Each one reads the signed-in user's own
 * data through the same services the dashboard uses, so the model sees
 * exactly what the user sees and nothing else.
 *
 * Two rules shape this class:
 *
 * <ul>
 *   <li>The user id always comes from the caller's verified token. No tool
 *       takes a user or portfolio id as an argument, so the model cannot be
 *       talked into reading someone else's data.
 *   <li>Every tool is read-only. The model can look; it cannot post to the
 *       ledger.
 * </ul>
 *
 * Figures are rounded here, once, to the precision the app displays (cents
 * for money, one decimal for percentages), so the model can quote them as
 * given and {@link GroundingVerifier} can check that it did.
 */
@Component
public class AiTools {

  /** Raised when a tool cannot produce a result; the message is shown to the model. */
  public static class ToolException extends RuntimeException {
    public ToolException(String message) {
      super(message);
    }
  }

  public static final String GET_PORTFOLIO = "get_portfolio";
  public static final String GET_RISK = "get_risk";
  public static final String GET_STRESS_TESTS = "get_stress_tests";
  public static final String GET_TRANSACTIONS = "get_recent_transactions";

  private static final BigDecimal HUNDRED = BigDecimal.valueOf(100);

  private final PortfolioService portfolio;
  private final RiskEngineClient risk;
  private final LedgerService ledger;
  private final ObjectMapper json;

  public AiTools(
      PortfolioService portfolio, RiskEngineClient risk, LedgerService ledger, ObjectMapper json) {
    this.portfolio = portfolio;
    this.risk = risk;
    this.ledger = ledger;
    this.json = json;
  }

  public List<ToolSpec> specs() {
    ObjectNode none = schema();

    ObjectNode riskInput = schema();
    ObjectNode riskProps = (ObjectNode) riskInput.get("properties");
    ObjectNode confidence = riskProps.putObject("confidence");
    confidence.put("type", "string");
    confidence.putArray("enum").add("0.95").add("0.99");
    confidence.put("description", "Confidence level. Defaults to 0.95.");
    ObjectNode horizon = riskProps.putObject("horizon_days");
    horizon.put("type", "integer");
    horizon.putArray("enum").add(1).add(10);
    horizon.put("description", "Holding period in trading days. Defaults to 1.");

    ObjectNode txInput = schema();
    ObjectNode limit = ((ObjectNode) txInput.get("properties")).putObject("limit");
    limit.put("type", "integer");
    limit.put("minimum", 1);
    limit.put("maximum", 20);
    limit.put("description", "How many of the most recent transactions to return. Defaults to 10.");

    return List.of(
        new ToolSpec(
            GET_PORTFOLIO,
            "The user's current portfolio: total value, cash, and each position with its shares, "
                + "average cost, price, value, weight and unrealised gain. Use this for questions "
                + "about holdings, allocation, concentration or returns.",
            none),
        new ToolSpec(
            GET_RISK,
            "Risk figures for the user's portfolio from Motion's risk engine: value at risk, "
                + "expected shortfall, volatility, beta and each position's share of total risk. "
                + "Figures come from an illustrative model, not live market data.",
            riskInput),
        new ToolSpec(
            GET_STRESS_TESTS,
            "What the user's current portfolio would lose if a historical market episode "
                + "repeated (2008, 2020, 2022, the dot-com bust) or interest rates rose 2 points.",
            none),
        new ToolSpec(
            GET_TRANSACTIONS,
            "The user's most recent ledger transactions: deposits, withdrawals, buys, sells and "
                + "reversals.",
            txInput));
  }

  /**
   * Runs one tool for one user and returns its result as JSON text.
   *
   * @throws ToolException if the tool name is unknown or the tool cannot answer
   */
  public String execute(UUID userId, String name, JsonNode input) {
    JsonNode args = input == null ? json.createObjectNode() : input;
    try {
      JsonNode result =
          switch (name == null ? "" : name) {
            case GET_PORTFOLIO -> portfolio(userId);
            case GET_RISK -> risk(userId, args);
            case GET_STRESS_TESTS -> stressTests(userId);
            case GET_TRANSACTIONS -> transactions(userId, args);
            default -> throw new ToolException("Unknown tool: " + name);
          };
      // Plain notation always: 13625, never 1.3625E+4, which the model and the
      // grounding check would both misread.
      return json.writer().with(StreamWriteFeature.WRITE_BIGDECIMAL_AS_PLAIN).writeValueAsString(result);
    } catch (ApiException e) {
      throw new ToolException(e.getMessage());
    } catch (JsonProcessingException e) {
      throw new ToolException("The tool result could not be encoded.");
    }
  }

  /** A short human label for the "figures from" line under an answer. */
  public static String label(String toolName) {
    return switch (toolName) {
      case GET_PORTFOLIO -> "Your positions";
      case GET_RISK -> "Risk engine";
      case GET_STRESS_TESTS -> "Stress tests";
      case GET_TRANSACTIONS -> "Your transactions";
      default -> toolName;
    };
  }

  // ------------------------------------------------------------------ tools

  JsonNode portfolio(UUID userId) {
    PortfolioView view = portfolio.view(userId);
    BigDecimal total = view.totalValue();
    List<HoldingView> holdings =
        view.holdings().stream().sorted(Comparator.comparing(HoldingView::value).reversed()).toList();

    BigDecimal invested = BigDecimal.ZERO;
    BigDecimal basis = BigDecimal.ZERO;
    BigDecimal top3 = BigDecimal.ZERO;
    ObjectNode root = json.createObjectNode();
    ArrayNode positions = json.createArrayNode();
    for (int i = 0; i < holdings.size(); i++) {
      HoldingView h = holdings.get(i);
      invested = invested.add(h.value());
      basis = basis.add(h.basis());
      if (i < 3) {
        top3 = top3.add(h.value());
      }
      ObjectNode p = positions.addObject();
      p.put("ticker", h.ticker());
      p.put("shares", plain(h.shares()));
      p.put("average_cost", money(h.cost()));
      p.put("price", money(h.price()));
      p.put("value", money(h.value()));
      p.put("weight_pct", percent(h.value(), total));
      p.put("unrealized_gain", money(h.value().subtract(h.basis())));
      p.put("unrealized_gain_pct", percent(h.value().subtract(h.basis()), h.basis()));
    }
    root.put("total_value", money(total));
    root.put("cash", money(view.cash()));
    root.put("cash_pct", percent(view.cash(), total));
    root.put("invested_value", money(invested));
    root.put("position_count", holdings.size());
    root.put("top3_positions_pct", percent(top3, total));
    root.put("unrealized_gain", money(invested.subtract(basis)));
    root.put("unrealized_gain_pct", percent(invested.subtract(basis), basis));
    root.put("realized_gain", money(view.realizedGain()));
    root.put("net_contributions", money(view.contributions()));
    root.set("positions", positions);
    root.put("note", "Prices are the last trade or user-entered, not live market data.");
    return root;
  }

  JsonNode risk(UUID userId, JsonNode args) {
    String confidence = args.path("confidence").asText("0.95");
    int horizon = args.path("horizon_days").asInt(1);
    JsonNode r = risk.analyze(userId, confidence, horizon);

    ObjectNode root = json.createObjectNode();
    root.put("confidence_pct", plain(new BigDecimal(confidence).multiply(HUNDRED)));
    root.put("horizon_days", horizon);
    root.put("value_at_risk", money(r.path("var").path("monte_carlo").decimalValue()));
    root.put("value_at_risk_pct", fractionToPercent(r.path("var").path("monte_carlo_pct")));
    root.put("expected_shortfall", money(r.path("cvar").path("monte_carlo").decimalValue()));
    root.put("expected_shortfall_pct", fractionToPercent(r.path("cvar").path("monte_carlo_pct")));
    root.put("annual_volatility_pct", fractionToPercent(r.path("volatility")));
    root.put("beta_to_market", r.path("beta").decimalValue().setScale(2, RoundingMode.HALF_EVEN));
    ArrayNode contributions = root.putArray("risk_contributions");
    List<JsonNode> positions = new ArrayList<>();
    r.path("positions").forEach(positions::add);
    positions.sort(
        Comparator.comparing((JsonNode p) -> p.path("risk_contribution").asDouble()).reversed());
    for (JsonNode p : positions) {
      ObjectNode c = contributions.addObject();
      c.put("ticker", p.path("ticker").asText());
      c.put("share_of_risk_pct", fractionToPercent(p.path("risk_contribution")));
      c.put("weight_pct", fractionToPercent(p.path("weight")));
    }
    root.put(
        "meaning",
        "value_at_risk is the loss the portfolio is expected to stay within over the horizon at "
            + "the confidence level; expected_shortfall is the average loss in the cases that are "
            + "worse than that.");
    root.put("model_note", r.path("model").path("note").asText());
    return root;
  }

  JsonNode stressTests(UUID userId) {
    JsonNode r = risk.analyze(userId, "0.95", 1);
    ObjectNode root = json.createObjectNode();
    ArrayNode scenarios = root.putArray("scenarios");
    for (JsonNode s : r.path("scenarios")) {
      ObjectNode out = scenarios.addObject();
      out.put("scenario", s.path("name").asText());
      out.put("description", s.path("description").asText());
      out.put("portfolio_change", money(s.path("pnl").decimalValue()));
      out.put("portfolio_change_pct", fractionToPercent(s.path("pnl_pct")));
      List<JsonNode> positions = new ArrayList<>();
      s.path("positions").forEach(positions::add);
      positions.sort(Comparator.comparing((JsonNode p) -> p.path("pnl").asDouble()));
      ArrayNode worst = out.putArray("largest_position_changes");
      for (JsonNode p : positions.subList(0, Math.min(3, positions.size()))) {
        ObjectNode w = worst.addObject();
        w.put("ticker", p.path("ticker").asText());
        w.put("change", money(p.path("pnl").decimalValue()));
      }
    }
    root.put("model_note", r.path("model").path("note").asText());
    return root;
  }

  JsonNode transactions(UUID userId, JsonNode args) {
    int limit = Math.max(1, Math.min(args.path("limit").asInt(10), 20));
    ObjectNode root = json.createObjectNode();
    ArrayNode list = root.putArray("transactions");
    for (TransactionView tx : ledger.recent(userId, limit)) {
      ObjectNode t = list.addObject();
      t.put("type", tx.type().name());
      if (tx.ticker() != null) {
        t.put("ticker", tx.ticker());
        t.put("shares", plain(tx.quantity()));
        t.put("price", money(tx.price()));
      }
      t.put("amount", money(tx.amount()));
      t.put("date", tx.createdAt().toString().substring(0, 10));
      if (tx.reversed()) {
        t.put("reversed", true);
      }
    }
    return root;
  }

  // ---------------------------------------------------------------- helpers

  private ObjectNode schema() {
    ObjectNode schema = json.createObjectNode();
    schema.put("type", "object");
    schema.putObject("properties");
    return schema;
  }

  /** Drops trailing zeros without tipping into scientific notation (25.000000 becomes 25, not 2.5E+1). */
  private static BigDecimal plain(BigDecimal value) {
    BigDecimal stripped = value.stripTrailingZeros();
    return stripped.scale() < 0 ? stripped.setScale(0) : stripped;
  }

  private static BigDecimal money(BigDecimal value) {
    return value.setScale(2, RoundingMode.HALF_EVEN);
  }

  /** part / whole as a percentage with one decimal; zero when there is no whole. */
  private static BigDecimal percent(BigDecimal part, BigDecimal whole) {
    if (whole.signum() == 0) {
      return BigDecimal.ZERO.setScale(1);
    }
    return part.multiply(HUNDRED).divide(whole, 1, RoundingMode.HALF_EVEN);
  }

  private static BigDecimal fractionToPercent(JsonNode fraction) {
    return fraction.decimalValue().multiply(HUNDRED).setScale(1, RoundingMode.HALF_EVEN);
  }
}
