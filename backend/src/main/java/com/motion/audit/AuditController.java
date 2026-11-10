package com.motion.audit;

import com.fasterxml.jackson.annotation.JsonRawValue;
import com.motion.auth.CurrentUser;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class AuditController {

  /** `detail` is already JSON in the database, so it is passed through as-is. */
  public record AuditEventView(
      long id, UUID userId, String action, @JsonRawValue String detail, String ip, Instant createdAt) {

    static AuditEventView of(AuditService.AuditEvent e) {
      return new AuditEventView(e.id(), e.userId(), e.action(), e.detail(), e.ip(), e.createdAt());
    }
  }

  private final AuditService audit;

  public AuditController(AuditService audit) {
    this.audit = audit;
  }

  /** The caller's own activity. */
  @GetMapping("/api/audit")
  public Map<String, List<AuditEventView>> mine(
      @AuthenticationPrincipal Jwt jwt, @RequestParam(defaultValue = "50") int limit) {
    List<AuditEventView> events =
        audit.forUser(CurrentUser.id(jwt), clamp(limit)).stream().map(AuditEventView::of).toList();
    return Map.of("events", events);
  }

  /** Everyone's activity. SecurityConfig restricts /api/admin/** to the ADMIN role. */
  @GetMapping("/api/admin/audit")
  public Map<String, List<AuditEventView>> all(@RequestParam(defaultValue = "100") int limit) {
    List<AuditEventView> events =
        audit.all(clamp(limit)).stream().map(AuditEventView::of).toList();
    return Map.of("events", events);
  }

  private static int clamp(int limit) {
    return Math.max(1, Math.min(limit, 200));
  }
}
