package com.motion.audit;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

/**
 * Writes and reads the audit log: who did what, when, and from where.
 *
 * A record written inside a database transaction commits or rolls back with
 * it, so the log can never claim a ledger posting that did not happen.
 */
@Service
public class AuditService {

  public record AuditEvent(
      long id, UUID userId, String action, String detail, String ip, Instant createdAt) {}

  private final JdbcClient jdbc;
  private final ObjectMapper json;

  public AuditService(JdbcClient jdbc, ObjectMapper json) {
    this.jdbc = jdbc;
    this.json = json;
  }

  public void record(UUID userId, String action, Map<String, Object> detail) {
    String ip = null;
    String userAgent = null;
    if (RequestContextHolder.getRequestAttributes() instanceof ServletRequestAttributes attrs) {
      HttpServletRequest request = attrs.getRequest();
      ip = request.getRemoteAddr();
      userAgent = truncate(request.getHeader("User-Agent"), 300);
    }
    jdbc.sql(
            """
            INSERT INTO audit_log (user_id, action, detail, ip, user_agent)
            VALUES (?, ?, ?::jsonb, ?, ?)
            """)
        .params(userId, action, toJson(detail), ip, userAgent)
        .update();
  }

  public List<AuditEvent> forUser(UUID userId, int limit) {
    return jdbc.sql(
            """
            SELECT id, user_id, action, detail::text AS detail, ip, created_at
            FROM audit_log WHERE user_id = ? ORDER BY id DESC LIMIT ?
            """)
        .params(userId, limit)
        .query(AuditService::map)
        .list();
  }

  public List<AuditEvent> all(int limit) {
    return jdbc.sql(
            """
            SELECT id, user_id, action, detail::text AS detail, ip, created_at
            FROM audit_log ORDER BY id DESC LIMIT ?
            """)
        .param(limit)
        .query(AuditService::map)
        .list();
  }

  private static AuditEvent map(java.sql.ResultSet rs, int row) throws java.sql.SQLException {
    return new AuditEvent(
        rs.getLong("id"),
        rs.getObject("user_id", UUID.class),
        rs.getString("action"),
        rs.getString("detail"),
        rs.getString("ip"),
        rs.getTimestamp("created_at").toInstant());
  }

  private String toJson(Map<String, Object> detail) {
    try {
      return json.writeValueAsString(detail == null ? Map.of() : detail);
    } catch (JsonProcessingException e) {
      return "{}";
    }
  }

  private static String truncate(String value, int max) {
    return value == null || value.length() <= max ? value : value.substring(0, max);
  }
}
