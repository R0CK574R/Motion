package com.motion.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.motion.common.ErrorBody;
import com.nimbusds.jose.jwk.source.ImmutableSecret;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.List;
import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.MediaType;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationConverter;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.access.AccessDeniedHandler;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

/**
 * Who may call what.
 *
 * The API is stateless: every request carries a short-lived JWT access token
 * in the Authorization header. There is no server-side session. The only
 * cookie is the httpOnly refresh token, scoped to /api/auth.
 */
@Configuration
public class SecurityConfig {

  /** Endpoints that work without an access token. */
  private static final String[] PUBLIC_PATHS = {
    "/health",
    "/api/health",
    "/api/auth/register",
    "/api/auth/login",
    "/api/auth/refresh",
    "/api/auth/logout",
    "/api/auth/demo",
    "/api/billing/webhook", // authenticated by Stripe's signature instead
    "/v3/api-docs/**",
    "/swagger-ui/**",
    "/swagger-ui.html",
    "/error"
  };

  @Bean
  public SecurityFilterChain filterChain(HttpSecurity http, ObjectMapper json) throws Exception {
    AuthenticationEntryPoint unauthenticated =
        (request, response, ex) ->
            writeError(json, response, 401, "Access token invalid or expired");
    AccessDeniedHandler forbidden =
        (request, response, ex) -> writeError(json, response, 403, "Not allowed");

    http
        // CSRF protection guards cookie-authenticated requests. Here the
        // credential is a bearer token that a browser never attaches on its
        // own, so there is nothing for a forged cross-site request to ride on.
        .csrf(csrf -> csrf.disable())
        .cors(Customizer.withDefaults())
        .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
        .authorizeHttpRequests(
            auth ->
                auth.requestMatchers(PUBLIC_PATHS)
                    .permitAll()
                    .requestMatchers("/api/admin/**")
                    .hasRole("ADMIN")
                    .anyRequest()
                    .authenticated())
        .oauth2ResourceServer(
            oauth ->
                oauth
                    .jwt(jwt -> jwt.jwtAuthenticationConverter(jwtAuthenticationConverter()))
                    .authenticationEntryPoint(unauthenticated)
                    .accessDeniedHandler(forbidden))
        .exceptionHandling(
            e -> e.authenticationEntryPoint(unauthenticated).accessDeniedHandler(forbidden));
    return http.build();
  }

  private static void writeError(
      ObjectMapper json, HttpServletResponse response, int status, String message)
      throws IOException {
    response.setStatus(status);
    response.setContentType(MediaType.APPLICATION_JSON_VALUE);
    json.writeValue(response.getWriter(), ErrorBody.of(message));
  }

  /** Maps the token's "role" claim to a Spring authority such as ROLE_ADMIN. */
  private static JwtAuthenticationConverter jwtAuthenticationConverter() {
    JwtAuthenticationConverter converter = new JwtAuthenticationConverter();
    converter.setJwtGrantedAuthoritiesConverter(
        jwt -> {
          String role = jwt.getClaimAsString("role");
          List<GrantedAuthority> authorities =
              List.of(new SimpleGrantedAuthority("ROLE_" + (role == null ? "USER" : role)));
          return authorities;
        });
    return converter;
  }

  /** Only the frontend's own origin may call the API from a browser. */
  @Bean
  public CorsConfigurationSource corsConfigurationSource(AppProperties props) {
    CorsConfiguration cors = new CorsConfiguration();
    cors.setAllowedOrigins(List.of(props.appUrl()));
    cors.setAllowedMethods(List.of("GET", "POST", "PUT", "DELETE", "OPTIONS"));
    cors.setAllowedHeaders(List.of("Authorization", "Content-Type", "Idempotency-Key"));
    cors.setExposedHeaders(List.of("Idempotent-Replay", "Retry-After"));
    cors.setAllowCredentials(true); // so the refresh cookie is sent and stored
    cors.setMaxAge(3600L);
    UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
    source.registerCorsConfiguration("/**", cors);
    return source;
  }

  @Bean
  public SecretKey jwtSigningKey(AppProperties props) {
    String secret = props.jwtSecret();
    if (AppProperties.blank(secret) || secret.getBytes(StandardCharsets.UTF_8).length < 32) {
      throw new IllegalStateException(
          "JWT_ACCESS_SECRET must be set to at least 32 characters. Generate one with: "
              + "openssl rand -hex 48");
    }
    return new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256");
  }

  @Bean
  public JwtDecoder jwtDecoder(SecretKey jwtSigningKey) {
    return NimbusJwtDecoder.withSecretKey(jwtSigningKey).macAlgorithm(MacAlgorithm.HS256).build();
  }

  @Bean
  public JwtEncoder jwtEncoder(SecretKey jwtSigningKey) {
    return new NimbusJwtEncoder(new ImmutableSecret<>(jwtSigningKey));
  }

  @Bean
  public PasswordEncoder passwordEncoder(AppProperties props) {
    return new BCryptPasswordEncoder(props.bcryptStrength());
  }
}
