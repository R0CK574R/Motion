package com.motion.analysis;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.motion.ai.AiCallLog;
import com.motion.ai.ModelClient;
import com.motion.audit.AuditService;
import com.motion.auth.AuthService;
import com.motion.auth.CurrentUser;
import com.motion.common.ApiException;
import com.motion.portfolio.PortfolioService;
import com.motion.portfolio.PortfolioService.HoldingView;
import com.motion.portfolio.PortfolioService.PortfolioView;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * POST /api/analysis: an AI-written description of the portfolio's
 * composition. Paid feature: the subscription check is enforced here, on the
 * server, not hidden in the UI. The AI provider key never leaves the server,
 * and the portfolio sent to the model is rebuilt from the ledger.
 */
@RestController
public class AnalysisController {

  private static final Logger log = LoggerFactory.getLogger(AnalysisController.class);

  private static final String PROMPT_VERSION = "analysis-v1";

  private static final String SYSTEM_PROMPT =
      """
      You are a portfolio analytics engine. You classify holdings and describe a portfolio's composition and concentration in plain, educational language.
      Hard rule: you NEVER give investment advice and NEVER recommend buying, selling, holding, adding, or trimming any security or asset. You describe, you do not prescribe.
      Classify each holding:
      - assetClass: one of "US Equity", "International Equity", "Bond", "Real Estate", "Commodity", "Crypto", "Cash", "Other".
      - sector: for single stocks use a GICS-style sector (e.g., Technology, Healthcare, Financials, Consumer Discretionary, Energy). For broad index/total-market funds use "Broad Market". For bond/other funds use the closest fit.
      Then write:
      - observations: 2 to 4 neutral, factual sentences about the portfolio's shape (weightings, tilts, diversification), grounded in the numbers given.
      - risks: 2 to 3 plain-language notes on concentration or single-name exposure, phrased as observations of fact, never as recommendations.
      Respond with ONLY valid JSON, no markdown fences, no preamble:
      {"classifications":[{"ticker":string,"assetClass":string,"sector":string}],"observations":[string],"risks":[string]}""";

  private final AuthService auth;
  private final PortfolioService portfolio;
  private final AuditService audit;
  private final ObjectMapper json;
  private final ModelClient model;
  private final AiCallLog calls;

  public AnalysisController(
      AuthService auth,
      PortfolioService portfolio,
      AuditService audit,
      ObjectMapper json,
      ModelClient model,
      AiCallLog calls) {
    this.auth = auth;
    this.portfolio = portfolio;
    this.audit = audit;
    this.json = json;
    this.model = model;
    this.calls = calls;
  }

  @PostMapping("/api/analysis")
  public JsonNode analyze(@AuthenticationPrincipal Jwt jwt) throws JsonProcessingException {
    UUID userId = CurrentUser.id(jwt);
    AuthService.Account account = auth.account(userId);

    // Demo accounts see the paid feature (that is the point of the demo) but
    // are served a fixed result, so they never reach the AI provider.
    if (account.demo()) {
      return json.readTree(DemoAnalysis.JSON);
    }
    String status = account.subscriptionStatus();
    if (!"active".equals(status) && !"trialing".equals(status)) {
      throw new ApiException(
          HttpStatus.PAYMENT_REQUIRED,
          "An active subscription is required for this feature.",
          "SUBSCRIPTION_REQUIRED");
    }
    if (!model.configured()) {
      throw new ApiException(
          HttpStatus.INTERNAL_SERVER_ERROR, "Server is not configured with an AI provider key.");
    }

    PortfolioView view = portfolio.view(userId);
    if (view.holdings().isEmpty()) {
      throw ApiException.badRequest("Add at least one holding before running analysis.");
    }

    long started = System.nanoTime();
    ModelClient.Response response;
    try {
      response =
          model.send(
              new ModelClient.Request(
                  SYSTEM_PROMPT, List.of(ModelClient.Message.user(describe(view))), List.of(), 1000));
    } catch (ModelClient.ModelException e) {
      logCall(userId, "error", response(0, 0), started, e.getMessage());
      throw new ApiException(HttpStatus.BAD_GATEWAY, "AI provider request failed.");
    }

    String text = response.text();
    String clean = text.replaceAll("(?i)```json", "").replace("```", "").trim();
    try {
      JsonNode parsed = json.readTree(clean);
      if (parsed == null || !parsed.isObject()) {
        logCall(userId, "error", response, started, "The model's reply was not a JSON object.");
        throw new ApiException(HttpStatus.BAD_GATEWAY, "AI response was not valid JSON.");
      }
      audit.record(userId, "ANALYSIS_RUN", Map.of("holdings", view.holdings().size()));
      logCall(userId, "ok", response, started, null);
      return parsed;
    } catch (JsonProcessingException e) {
      log.error("AI response was not valid JSON");
      logCall(userId, "error", response, started, "The model's reply was not valid JSON.");
      throw new ApiException(HttpStatus.BAD_GATEWAY, "AI response was not valid JSON.");
    }
  }

  private static ModelClient.Response response(int inputTokens, int outputTokens) {
    return new ModelClient.Response(List.of(), "", inputTokens, outputTokens);
  }

  private void logCall(UUID userId, String status, ModelClient.Response response, long started, String error) {
    try {
      calls.record(
          new AiCallLog.Entry(
              userId, false, "analysis", PROMPT_VERSION, model.model(), status, null, null, List.of(), 1,
              response.inputTokens(), response.outputTokens(), (System.nanoTime() - started) / 1_000_000,
              null, List.of(), false, error));
    } catch (RuntimeException e) {
      log.error("Could not write the AI call log: {}", e.getMessage());
    }
  }

  /** The portfolio as plain text for the model: weights and returns, no dollar amounts. */
  static String describe(PortfolioView view) {
    BigDecimal total = view.totalValue();
    List<HoldingView> holdings =
        view.holdings().stream().sorted(Comparator.comparing(HoldingView::value).reversed()).toList();

    StringBuilder lines = new StringBuilder("Holdings:\n");
    BigDecimal top3 = BigDecimal.ZERO;
    for (int i = 0; i < holdings.size(); i++) {
      HoldingView h = holdings.get(i);
      BigDecimal weight = ratio(h.value(), total);
      BigDecimal gain = ratio(h.value().subtract(h.basis()), h.basis());
      if (i < 3) {
        top3 = top3.add(weight);
      }
      lines.append(h.ticker())
          .append(": ")
          .append(percent(weight))
          .append(" of portfolio, return ")
          .append(gain.signum() >= 0 ? "+" : "")
          .append(percent(gain))
          .append('\n');
    }
    HoldingView largest = holdings.get(0);
    lines.append("\nLargest position: ")
        .append(largest.ticker())
        .append(" at ")
        .append(percent(ratio(largest.value(), total)))
        .append(". Top 3 positions: ")
        .append(percent(top3))
        .append(". Cash: ")
        .append(percent(ratio(view.cash(), total)))
        .append(". Number of holdings: ")
        .append(holdings.size())
        .append('.');
    return lines.toString();
  }

  private static BigDecimal ratio(BigDecimal part, BigDecimal whole) {
    return whole.signum() == 0 ? BigDecimal.ZERO : part.divide(whole, 6, RoundingMode.HALF_EVEN);
  }

  private static String percent(BigDecimal ratio) {
    return ratio.multiply(BigDecimal.valueOf(100)).setScale(1, RoundingMode.HALF_EVEN).toPlainString() + "%";
  }
}
