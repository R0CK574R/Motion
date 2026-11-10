package com.motion.ai;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.motion.config.AppProperties;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;

/**
 * Calls the Claude Messages API.
 *
 * The API key is read from the ANTHROPIC_API_KEY environment variable, sent
 * only as a request header to api.anthropic.com, and never logged, stored or
 * returned to a browser. Errors are logged by status code alone.
 */
@Component
public class AnthropicModelClient implements ModelClient {

  private static final Logger log = LoggerFactory.getLogger(AnthropicModelClient.class);
  private static final String URL = "https://api.anthropic.com/v1/messages";
  private static final String API_VERSION = "2023-06-01";

  private final String apiKey;
  private final String model;
  private final ObjectMapper json;
  private final RestClient http;

  public AnthropicModelClient(AppProperties props, ObjectMapper json) {
    this.apiKey = AppProperties.blank(props.anthropicApiKey()) ? null : props.anthropicApiKey().trim();
    this.model = props.anthropicModel();
    this.json = json;
    SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
    factory.setConnectTimeout(Duration.ofSeconds(5));
    factory.setReadTimeout(Duration.ofSeconds(60));
    this.http = RestClient.builder().requestFactory(factory).build();
  }

  @Override
  public boolean configured() {
    return apiKey != null;
  }

  @Override
  public String model() {
    return model;
  }

  @Override
  public Response send(Request request) {
    if (apiKey == null) {
      throw new ModelException("No AI provider key is configured.");
    }
    JsonNode body;
    try {
      body =
          http.post()
              .uri(URL)
              .contentType(MediaType.APPLICATION_JSON)
              .header("x-api-key", apiKey)
              .header("anthropic-version", API_VERSION)
              .body(toJson(request))
              .retrieve()
              .body(JsonNode.class);
    } catch (RestClientResponseException e) {
      log.error("AI provider returned HTTP {}", e.getStatusCode().value());
      throw new ModelException("AI provider returned HTTP " + e.getStatusCode().value());
    } catch (RestClientException e) {
      log.error("AI provider unreachable: {}", e.getClass().getSimpleName());
      throw new ModelException("AI provider unreachable");
    }
    if (body == null) {
      throw new ModelException("AI provider returned an empty response");
    }
    return fromJson(body);
  }

  private ObjectNode toJson(Request request) {
    ObjectNode root = json.createObjectNode();
    root.put("model", model);
    root.put("max_tokens", request.maxTokens());
    root.put("system", request.system());

    ArrayNode messages = root.putArray("messages");
    for (Message message : request.messages()) {
      ObjectNode m = messages.addObject();
      m.put("role", message.role());
      ArrayNode content = m.putArray("content");
      for (Block block : message.content()) {
        ObjectNode b = content.addObject();
        if (block instanceof Text text) {
          b.put("type", "text");
          b.put("text", text.text());
        } else if (block instanceof ToolUse use) {
          b.put("type", "tool_use");
          b.put("id", use.id());
          b.put("name", use.name());
          b.set("input", use.input() == null ? json.createObjectNode() : use.input());
        } else if (block instanceof ToolResult result) {
          b.put("type", "tool_result");
          b.put("tool_use_id", result.toolUseId());
          b.put("content", result.content());
          if (result.error()) {
            b.put("is_error", true);
          }
        }
      }
    }

    if (request.tools() != null && !request.tools().isEmpty()) {
      ArrayNode tools = root.putArray("tools");
      for (ToolSpec tool : request.tools()) {
        ObjectNode t = tools.addObject();
        t.put("name", tool.name());
        t.put("description", tool.description());
        t.set("input_schema", tool.inputSchema());
      }
    }
    return root;
  }

  private Response fromJson(JsonNode body) {
    List<Block> content = new ArrayList<>();
    for (JsonNode block : body.path("content")) {
      String type = block.path("type").asText();
      if ("text".equals(type)) {
        content.add(new Text(block.path("text").asText()));
      } else if ("tool_use".equals(type)) {
        content.add(
            new ToolUse(block.path("id").asText(), block.path("name").asText(), block.path("input")));
      }
      // Any other block type (for example model reasoning) is not needed here.
    }
    return new Response(
        content,
        body.path("stop_reason").asText(""),
        body.path("usage").path("input_tokens").asInt(0),
        body.path("usage").path("output_tokens").asInt(0));
  }
}
