package com.motion.common;

import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Liveness check. Answers at /health for the hosting platform and at
 * /api/health for the website, which reaches the API only under /api.
 * It touches nothing else, so checking it never wakes the database.
 */
@RestController
public class HealthController {

  @GetMapping({"/health", "/api/health"})
  public Map<String, Boolean> health() {
    return Map.of("ok", true);
  }
}
