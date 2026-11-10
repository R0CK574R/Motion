package com.motion.ai;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/** Reads and writes the ai_calls table. */
@Repository
public class AiCallLog {

  /** One finished AI request, successful or not. */
  public record Entry(
      UUID userId,
      boolean demo,
      String feature,
      String promptVersion,
      String model,
      String status,
      String question,
      String answer,
      List<String> tools,
      int modelTurns,
      int inputTokens,
      int outputTokens,
      long latencyMs,
      Boolean grounded,
      List<String> ungrounded,
      boolean adviceBlocked,
      String error) {}

  public record Summary(
      long id,
      String feature,
      String model,
      String status,
      String question,
      int inputTokens,
      int outputTokens,
      int latencyMs,
      Boolean grounded,
      boolean adviceBlocked,
      Instant createdAt) {}

  private final JdbcClient jdbc;
  private final ObjectMapper json;

  public AiCallLog(JdbcClient jdbc, ObjectMapper json) {
    this.jdbc = jdbc;
    this.json = json;
  }

  public void record(Entry e) {
    jdbc.sql(
            """
            INSERT INTO ai_calls
              (user_id, is_demo, feature, prompt_version, model, status, question, answer, tools,
               model_turns, input_tokens, output_tokens, latency_ms, grounded, ungrounded,
               advice_blocked, error)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?, ?, ?, ?, ?, ?::jsonb, ?, ?)
            """)
        .params(
            e.userId(),
            e.demo(),
            e.feature(),
            e.promptVersion(),
            e.model(),
            e.status(),
            e.question(),
            e.answer(),
            toJson(e.tools()),
            e.modelTurns(),
            e.inputTokens(),
            e.outputTokens(),
            (int) Math.min(e.latencyMs(), Integer.MAX_VALUE),
            e.grounded(),
            toJson(e.ungrounded()),
            e.adviceBlocked(),
            e.error())
        .update();
  }

  /** Requests this user has sent to the model in the last 24 hours. */
  public int countForUser(UUID userId) {
    return jdbc.sql(
            """
            SELECT COUNT(*) FROM ai_calls
            WHERE user_id = ? AND status <> 'sample' AND created_at > now() - interval '24 hours'
            """)
        .param(userId)
        .query(Integer.class)
        .single();
  }

  /** Requests all demo accounts together have sent to the model in the last 24 hours. */
  public int countForDemo() {
    return jdbc.sql(
            """
            SELECT COUNT(*) FROM ai_calls
            WHERE is_demo AND status <> 'sample' AND created_at > now() - interval '24 hours'
            """)
        .query(Integer.class)
        .single();
  }

  public List<Summary> recent(UUID userId, int limit) {
    return jdbc.sql(
            """
            SELECT id, feature, model, status, question, input_tokens, output_tokens, latency_ms,
                   grounded, advice_blocked, created_at
            FROM ai_calls WHERE user_id = ? ORDER BY id DESC LIMIT ?
            """)
        .params(userId, limit)
        .query(
            (rs, i) ->
                new Summary(
                    rs.getLong("id"),
                    rs.getString("feature"),
                    rs.getString("model"),
                    rs.getString("status"),
                    rs.getString("question"),
                    rs.getInt("input_tokens"),
                    rs.getInt("output_tokens"),
                    rs.getInt("latency_ms"),
                    (Boolean) rs.getObject("grounded"),
                    rs.getBoolean("advice_blocked"),
                    rs.getTimestamp("created_at").toInstant()))
        .list();
  }

  private String toJson(List<String> values) {
    try {
      return json.writeValueAsString(values == null ? List.of() : values);
    } catch (JsonProcessingException e) {
      return "[]";
    }
  }
}
