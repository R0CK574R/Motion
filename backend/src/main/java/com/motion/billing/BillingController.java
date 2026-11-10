package com.motion.billing;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.motion.audit.AuditService;
import com.motion.auth.AuthService;
import com.motion.auth.CurrentUser;
import com.motion.common.ApiException;
import com.motion.config.AppProperties;
import com.stripe.StripeClient;
import com.stripe.exception.SignatureVerificationException;
import com.stripe.exception.StripeException;
import com.stripe.net.Webhook;
import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Stripe subscription billing: start checkout, open the billing portal, receive webhooks. */
@RestController
@RequestMapping("/api/billing")
public class BillingController {

  private static final Logger log = LoggerFactory.getLogger(BillingController.class);
  private static final long SIGNATURE_TOLERANCE_SECONDS = 300;

  private final JdbcClient jdbc;
  private final AuthService auth;
  private final AuditService audit;
  private final ObjectMapper json;
  private final AppProperties props;
  private final StripeClient stripe;

  public BillingController(
      JdbcClient jdbc, AuthService auth, AuditService audit, ObjectMapper json, AppProperties props) {
    this.jdbc = jdbc;
    this.auth = auth;
    this.audit = audit;
    this.json = json;
    this.props = props;
    this.stripe =
        AppProperties.blank(props.stripe().secretKey())
            ? null
            : new StripeClient(props.stripe().secretKey());
  }

  @PostMapping("/create-checkout-session")
  public Map<String, String> createCheckoutSession(@AuthenticationPrincipal Jwt jwt) {
    requireStripe();
    if (AppProperties.blank(props.stripe().priceId())) {
      throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "STRIPE_PRICE_ID is not configured.");
    }
    UUID userId = CurrentUser.id(jwt);
    Optional<String> customerId = stripeCustomerId(userId);

    com.stripe.param.checkout.SessionCreateParams.Builder params =
        com.stripe.param.checkout.SessionCreateParams.builder()
            .setMode(com.stripe.param.checkout.SessionCreateParams.Mode.SUBSCRIPTION)
            .addLineItem(
                com.stripe.param.checkout.SessionCreateParams.LineItem.builder()
                    .setPrice(props.stripe().priceId())
                    .setQuantity(1L)
                    .build())
            .setSuccessUrl(props.appUrl() + "/billing/success?session_id={CHECKOUT_SESSION_ID}")
            .setCancelUrl(props.appUrl() + "/billing/cancelled")
            .setClientReferenceId(userId.toString());
    if (customerId.isPresent()) {
      params.setCustomer(customerId.get());
    } else {
      params.setCustomerEmail(auth.account(userId).email());
    }

    try {
      String url = stripe.checkout().sessions().create(params.build()).getUrl();
      audit.record(userId, "CHECKOUT_START", Map.of());
      return Map.of("url", url);
    } catch (StripeException e) {
      log.error("Create checkout session failed: {}", e.getMessage());
      throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "Could not start checkout.");
    }
  }

  @PostMapping("/create-portal-session")
  public Map<String, String> createPortalSession(@AuthenticationPrincipal Jwt jwt) {
    requireStripe();
    String customerId =
        stripeCustomerId(CurrentUser.id(jwt))
            .orElseThrow(
                () -> ApiException.badRequest("No billing account found for this user yet."));
    try {
      String url =
          stripe
              .billingPortal()
              .sessions()
              .create(
                  com.stripe.param.billingportal.SessionCreateParams.builder()
                      .setCustomer(customerId)
                      .setReturnUrl(props.appUrl() + "/settings/billing")
                      .build())
              .getUrl();
      return Map.of("url", url);
    } catch (StripeException e) {
      log.error("Create portal session failed: {}", e.getMessage());
      throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "Could not open billing portal.");
    }
  }

  /**
   * Stripe calls this when a subscription changes. There is no access token:
   * the request is trusted only if its Stripe-Signature header is a valid
   * HMAC of the exact bytes received, made with the webhook secret. That is
   * why the body is read raw here instead of being parsed by the framework.
   */
  @PostMapping("/webhook")
  public ResponseEntity<Map<String, Object>> webhook(
      HttpServletRequest request,
      @RequestHeader(name = "Stripe-Signature", required = false) String signature)
      throws IOException {
    if (AppProperties.blank(props.stripe().webhookSecret())) {
      throw new ApiException(
          HttpStatus.INTERNAL_SERVER_ERROR, "STRIPE_WEBHOOK_SECRET is not configured.");
    }
    String payload = new String(request.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
    try {
      if (signature == null) {
        throw new SignatureVerificationException("missing signature", null);
      }
      Webhook.Signature.verifyHeader(
          payload, signature, props.stripe().webhookSecret(), SIGNATURE_TOLERANCE_SECONDS);
    } catch (SignatureVerificationException e) {
      log.warn("Stripe webhook signature verification failed: {}", e.getMessage());
      throw ApiException.badRequest("Webhook signature verification failed");
    }

    JsonNode event = json.readTree(payload);
    JsonNode object = event.path("data").path("object");
    switch (event.path("type").asText()) {
      case "checkout.session.completed" -> {
        String userId = object.path("client_reference_id").asText(null);
        if (userId != null) {
          jdbc.sql(
                  """
                  UPDATE subscriptions
                  SET stripe_customer_id = ?, stripe_subscription_id = ?, status = 'active',
                      updated_at = now()
                  WHERE user_id = ?::uuid
                  """)
              .params(
                  object.path("customer").asText(null),
                  object.path("subscription").asText(null),
                  userId)
              .update();
        }
      }
      case "customer.subscription.updated", "customer.subscription.deleted" -> {
        // Newer Stripe API versions report the period end on the subscription
        // item rather than on the subscription itself; accept either.
        JsonNode periodEnd = object.path("current_period_end");
        if (!periodEnd.isNumber()) {
          periodEnd = object.path("items").path("data").path(0).path("current_period_end");
        }
        jdbc.sql(
                """
                UPDATE subscriptions
                SET status = ?, current_period_end = COALESCE(?, current_period_end),
                    updated_at = now()
                WHERE stripe_subscription_id = ?
                """)
            .params(
                object.path("status").asText("none"),
                periodEnd.isNumber() ? Timestamp.from(Instant.ofEpochSecond(periodEnd.asLong())) : null,
                object.path("id").asText())
            .update();
      }
      default -> {
        // Events we do not act on are acknowledged so Stripe stops retrying them.
      }
    }
    return ResponseEntity.ok(Map.of("received", true));
  }

  private void requireStripe() {
    if (stripe == null) {
      throw new ApiException(
          HttpStatus.INTERNAL_SERVER_ERROR, "Stripe is not configured on this server.");
    }
  }

  private Optional<String> stripeCustomerId(UUID userId) {
    return jdbc.sql("SELECT stripe_customer_id FROM subscriptions WHERE user_id = ?")
        .param(userId)
        .query((rs, i) -> Optional.ofNullable(rs.getString(1)))
        .optional()
        .flatMap(o -> o);
  }
}
