package com.motion.auth;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.motion.common.ApiException;
import com.motion.config.AppProperties;
import jakarta.servlet.http.HttpServletResponse;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseCookie;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.CookieValue;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

  static final String REFRESH_COOKIE = "motion_refresh";

  public record Credentials(String email, String password) {}

  @JsonInclude(JsonInclude.Include.NON_NULL)
  public record UserView(UUID id, String email, @JsonProperty("isDemo") Boolean isDemo) {}

  @JsonInclude(JsonInclude.Include.NON_NULL)
  public record SessionView(String accessToken, UserView user, @JsonProperty("isDemo") Boolean isDemo) {}

  public record SubscriptionView(String status, Instant currentPeriodEnd) {}

  public record AccountView(UserView user, SubscriptionView subscription) {}

  private final AuthService auth;
  private final String sameSite;
  private final boolean secure;

  public AuthController(AuthService auth, AppProperties props) {
    this.auth = auth;
    // "lax" only sends the cookie to the same site, which covers localhost and
    // app.example.com + api.example.com. When the frontend and the API are on
    // unrelated domains the browser treats every call as cross-site and drops
    // a lax cookie silently, so that setup needs COOKIE_SAMESITE=none. Browsers
    // accept SameSite=None only together with Secure, hence the OR below.
    String configured =
        AppProperties.blank(props.cookieSameSite()) ? "lax" : props.cookieSameSite().trim();
    this.sameSite = configured.substring(0, 1).toUpperCase() + configured.substring(1).toLowerCase();
    this.secure = props.production() || "None".equals(sameSite);
  }

  @PostMapping("/register")
  public ResponseEntity<SessionView> register(
      @RequestBody(required = false) Credentials body, HttpServletResponse response) {
    Credentials c = body == null ? new Credentials(null, null) : body;
    AuthService.Session session = auth.register(c.email(), c.password());
    setRefreshCookie(response, session.refreshToken());
    return ResponseEntity.status(HttpStatus.CREATED).body(view(session, null));
  }

  @PostMapping("/login")
  public SessionView login(
      @RequestBody(required = false) Credentials body, HttpServletResponse response) {
    Credentials c = body == null ? new Credentials(null, null) : body;
    AuthService.Session session = auth.login(c.email(), c.password());
    setRefreshCookie(response, session.refreshToken());
    return view(session, null);
  }

  @PostMapping("/refresh")
  public Map<String, String> refresh(
      @CookieValue(name = REFRESH_COOKIE, required = false) String token,
      HttpServletResponse response) {
    if (token == null) {
      throw new ApiException(HttpStatus.UNAUTHORIZED, "No refresh session found.");
    }
    AuthService.Session session =
        auth.refresh(token)
            .orElseThrow(
                () -> {
                  clearRefreshCookie(response);
                  return new ApiException(
                      HttpStatus.UNAUTHORIZED, "Refresh session expired or invalid.");
                });
    setRefreshCookie(response, session.refreshToken());
    return Map.of("accessToken", session.accessToken());
  }

  @PostMapping("/demo")
  public ResponseEntity<SessionView> demo(HttpServletResponse response) {
    AuthService.Session session = auth.startDemo();
    setRefreshCookie(response, session.refreshToken());
    return ResponseEntity.status(HttpStatus.CREATED).body(view(session, true));
  }

  @GetMapping("/me")
  public AccountView me(@AuthenticationPrincipal Jwt jwt) {
    AuthService.Account a = auth.account(CurrentUser.id(jwt));
    return new AccountView(
        new UserView(a.id(), a.email(), a.demo()),
        new SubscriptionView(a.subscriptionStatus(), a.currentPeriodEnd()));
  }

  @PostMapping("/logout")
  public ResponseEntity<Void> logout(
      @CookieValue(name = REFRESH_COOKIE, required = false) String token,
      HttpServletResponse response) {
    auth.logout(token);
    clearRefreshCookie(response);
    return ResponseEntity.noContent().build();
  }

  private static SessionView view(AuthService.Session s, Boolean isDemo) {
    return new SessionView(s.accessToken(), new UserView(s.userId(), s.email(), null), isDemo);
  }

  private void setRefreshCookie(HttpServletResponse response, String token) {
    response.addHeader(
        HttpHeaders.SET_COOKIE, cookie(token, TokenService.REFRESH_TTL).toString());
  }

  /** A cookie is only removed if these attributes match the ones it was set with. */
  private void clearRefreshCookie(HttpServletResponse response) {
    response.addHeader(HttpHeaders.SET_COOKIE, cookie("", Duration.ZERO).toString());
  }

  private ResponseCookie cookie(String value, Duration maxAge) {
    return ResponseCookie.from(REFRESH_COOKIE, value)
        .httpOnly(true)
        .secure(secure)
        .sameSite(sameSite)
        .path("/api/auth")
        .maxAge(maxAge)
        .build();
  }
}
