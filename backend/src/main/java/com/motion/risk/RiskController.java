package com.motion.risk;

import com.fasterxml.jackson.databind.JsonNode;
import com.motion.auth.CurrentUser;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * GET /api/risk: risk figures for the caller's own portfolio. The browser
 * never supplies the numbers that get analysed; see {@link RiskEngineClient}.
 */
@RestController
public class RiskController {

  private final RiskEngineClient engine;

  public RiskController(RiskEngineClient engine) {
    this.engine = engine;
  }

  @GetMapping("/api/risk")
  public JsonNode risk(
      @AuthenticationPrincipal Jwt jwt,
      @RequestParam(defaultValue = "0.95") String confidence,
      @RequestParam(defaultValue = "1") int horizon) {
    return engine.analyze(CurrentUser.id(jwt), confidence, horizon);
  }
}
