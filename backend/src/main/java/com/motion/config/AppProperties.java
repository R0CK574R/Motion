package com.motion.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/** Typed view of the `motion.*` settings in application.yml. */
@ConfigurationProperties(prefix = "motion")
public record AppProperties(
    String environment,
    String appUrl,
    String databaseUrl,
    String pgSsl,
    String jwtSecret,
    String cookieSameSite,
    int bcryptStrength,
    int authRateLimitPerMinute,
    String riskEngineUrl,
    String anthropicApiKey,
    String anthropicModel,
    Stripe stripe) {

  public record Stripe(String secretKey, String priceId, String webhookSecret) {}

  public boolean production() {
    return "production".equalsIgnoreCase(environment);
  }

  public boolean sslRequired() {
    return "true".equalsIgnoreCase(pgSsl);
  }

  public static boolean blank(String value) {
    return value == null || value.isBlank();
  }
}
