package com.motion.common;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.motion.config.AppProperties;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.core.annotation.Order;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Caps how often one IP address may call the sign-in endpoints, to slow down
 * password guessing and stop the demo endpoint being used to flood the
 * database with accounts.
 *
 * Fixed one-minute windows, counted in memory. That is correct for a single
 * instance; with several instances behind a load balancer the counters would
 * need to move to a shared store such as Redis.
 *
 * Clients are told apart by the address the hosting platform's own proxy
 * reports (server.forward-headers-strategy), never by a header the client
 * could set itself. Behind a CDN such as Vercel that address belongs to the
 * CDN, so visitors arriving through the same CDN location share a window.
 * Keying on the visitor needs the CDN to prove itself to the API, with a
 * private network or a secret header.
 *
 * Order -50 places it after Spring Security's filter chain (order -100), so
 * CORS headers are already on the response when a 429 is sent and the browser
 * can read it.
 */
@Component
@Order(-50)
public class RateLimitFilter extends OncePerRequestFilter {

  private static final Set<String> LIMITED_PATHS =
      Set.of("/api/auth/login", "/api/auth/register", "/api/auth/demo");
  private static final long WINDOW_MS = 60_000;
  private static final int MAX_TRACKED_CLIENTS = 50_000;

  private record Window(long startedAt, int count) {}

  private final ConcurrentHashMap<String, Window> windows = new ConcurrentHashMap<>();
  private final int limit;
  private final ObjectMapper json;

  public RateLimitFilter(AppProperties props, ObjectMapper json) {
    this.limit = props.authRateLimitPerMinute();
    this.json = json;
  }

  @Override
  protected boolean shouldNotFilter(HttpServletRequest request) {
    return !"POST".equals(request.getMethod()) || !LIMITED_PATHS.contains(request.getRequestURI());
  }

  @Override
  protected void doFilterInternal(
      HttpServletRequest request, HttpServletResponse response, FilterChain chain)
      throws ServletException, IOException {
    long now = System.currentTimeMillis();
    if (windows.size() > MAX_TRACKED_CLIENTS) {
      windows.values().removeIf(w -> now - w.startedAt() >= WINDOW_MS);
    }
    Window window =
        windows.merge(
            request.getRemoteAddr(),
            new Window(now, 1),
            (old, fresh) ->
                now - old.startedAt() >= WINDOW_MS ? fresh : new Window(old.startedAt(), old.count() + 1));

    if (window.count() > limit) {
      long retryAfter = Math.max(1, (WINDOW_MS - (now - window.startedAt())) / 1000);
      response.setStatus(429);
      response.setHeader("Retry-After", String.valueOf(retryAfter));
      response.setContentType(MediaType.APPLICATION_JSON_VALUE);
      json.writeValue(
          response.getWriter(),
          new ErrorBody("Too many attempts. Please wait a minute and try again.", "RATE_LIMITED"));
      return;
    }
    chain.doFilter(request, response);
  }
}
