package com.motion.ai;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;

/**
 * The one seam between Motion and a language model. Everything above this
 * interface (tools, guardrails, logging) is ordinary code that can be tested
 * with a scripted fake; only {@link AnthropicModelClient} talks to a network.
 */
public interface ModelClient {

  /** False when no API key is set, in which case {@link #send} must not be called. */
  boolean configured();

  /** The model id requests are sent to. */
  String model();

  Response send(Request request);

  /** A function the model may ask the server to run. */
  record ToolSpec(String name, String description, JsonNode inputSchema) {}

  sealed interface Block permits Text, ToolUse, ToolResult {}

  record Text(String text) implements Block {}

  /** The model asking for a tool to be run. */
  record ToolUse(String id, String name, JsonNode input) implements Block {}

  /** The server's reply to a {@link ToolUse}. */
  record ToolResult(String toolUseId, String content, boolean error) implements Block {}

  record Message(String role, List<Block> content) {

    public static Message user(String text) {
      return new Message("user", List.of(new Text(text)));
    }

    public static Message user(List<Block> content) {
      return new Message("user", content);
    }

    public static Message assistant(List<Block> content) {
      return new Message("assistant", content);
    }
  }

  record Request(String system, List<Message> messages, List<ToolSpec> tools, int maxTokens) {}

  record Response(List<Block> content, String stopReason, int inputTokens, int outputTokens) {

    /** All text blocks joined together. */
    public String text() {
      StringBuilder text = new StringBuilder();
      for (Block block : content) {
        if (block instanceof Text t) {
          if (text.length() > 0) {
            text.append('\n');
          }
          text.append(t.text());
        }
      }
      return text.toString().trim();
    }

    public List<ToolUse> toolUses() {
      return content.stream()
          .filter(ToolUse.class::isInstance)
          .map(ToolUse.class::cast)
          .toList();
    }
  }

  /** The provider could not be reached or returned an error. */
  class ModelException extends RuntimeException {
    public ModelException(String message) {
      super(message);
    }
  }
}
