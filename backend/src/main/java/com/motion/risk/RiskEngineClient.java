package com.motion.risk;

import com.fasterxml.jackson.databind.JsonNode;
import com.motion.common.ApiException;
import com.motion.config.AppProperties;
import com.motion.portfolio.PortfolioService;
import com.motion.portfolio.PortfolioService.PortfolioView;
import java.math.BigDecimal;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;

/**
 * Values a user's positions from the ledger and asks the C++ risk engine
 * (risk-engine/, reached over HTTP) for value at risk, expected shortfall,
 * risk contributions and stress tests. Used by the risk endpoint and by the
 * AI tools, so both always see the same numbers.
 */
@Service
public class RiskEngineClient {

  private static final Logger log = LoggerFactory.getLogger(RiskEngineClient.class);

  // Only these settings are offered, so callers pick from an allow-list
  // rather than passing free-form numbers through to the engine.
  public static final Set<String> CONFIDENCE_LEVELS = Set.of("0.95", "0.99");
  public static final Set<Integer> HORIZONS = Set.of(1, 10);

  private final PortfolioService portfolio;
  private final String engineUrl;
  private final RestClient http;

  public RiskEngineClient(PortfolioService portfolio, AppProperties props) {
    this.portfolio = portfolio;
    this.engineUrl =
        AppProperties.blank(props.riskEngineUrl())
            ? null
            : props.riskEngineUrl().trim().replaceAll("/+$", "");
    SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
    factory.setConnectTimeout(Duration.ofSeconds(2));
    factory.setReadTimeout(Duration.ofSeconds(5));
    this.http = RestClient.builder().requestFactory(factory).build();
  }

  /**
   * @throws ApiException 400 for an unsupported setting, 503 if the engine is
   *     not configured or not reachable, 502 if it rejects the request
   */
  public JsonNode analyze(UUID userId, String confidence, int horizonDays) {
    if (!CONFIDENCE_LEVELS.contains(confidence) || !HORIZONS.contains(horizonDays)) {
      throw ApiException.badRequest("Unsupported confidence or horizon.");
    }
    if (engineUrl == null) {
      throw unavailable("The risk engine is not configured.");
    }

    PortfolioView view = portfolio.view(userId);
    List<Map<String, Object>> positions =
        view.holdings().stream()
            .filter(h -> h.value().signum() > 0)
            .map(
                h -> {
                  Map<String, Object> position = new LinkedHashMap<>();
                  position.put("ticker", h.ticker());
                  position.put("value", h.value());
                  return position;
                })
            .toList();
    Map<String, Object> payload = new LinkedHashMap<>();
    payload.put("cash", view.cash().max(BigDecimal.ZERO));
    payload.put("positions", positions);
    payload.put("confidence", new BigDecimal(confidence));
    payload.put("horizon_days", horizonDays);

    try {
      return http.post()
          .uri(engineUrl + "/risk")
          .contentType(MediaType.APPLICATION_JSON)
          .body(payload)
          .retrieve()
          .body(JsonNode.class);
    } catch (RestClientResponseException e) {
      log.error("Risk engine rejected request: {} {}", e.getStatusCode(), e.getResponseBodyAsString());
      throw new ApiException(
          HttpStatus.BAD_GATEWAY, "The risk engine could not process this portfolio.");
    } catch (RestClientException e) {
      log.error("Risk engine unreachable: {}", e.getMessage());
      throw unavailable("The risk engine is offline.");
    }
  }

  private static ApiException unavailable(String message) {
    return new ApiException(HttpStatus.SERVICE_UNAVAILABLE, message, "RISK_ENGINE_UNAVAILABLE");
  }
}
