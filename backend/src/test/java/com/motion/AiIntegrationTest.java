package com.motion;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.motion.ai.AdviceGuard;
import com.motion.ai.ModelClient;
import com.motion.ai.ModelClient.Block;
import com.motion.ai.ModelClient.Message;
import com.motion.ai.ModelClient.Request;
import com.motion.ai.ModelClient.Response;
import com.motion.ai.ModelClient.Text;
import com.motion.ai.ModelClient.ToolResult;
import com.motion.ai.ModelClient.ToolUse;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/**
 * The AI features with the model replaced by a script.
 *
 * Everything except the network call is real: the endpoints, the access
 * rules, the tools reading the ledger in Postgres, the guardrails and the
 * call log. The script decides what "the model" says, which lets each test
 * put the system in a precise situation: a model that invents a number, one
 * that gives advice, one that calls a tool that does not exist, one that
 * never stops.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class AiIntegrationTest {

  /** Replays queued responses and remembers what it was sent. */
  static class ScriptedModel implements ModelClient {
    final Deque<Response> script = new ArrayDeque<>();
    final List<List<Message>> conversations = new ArrayList<>();
    final List<Request> requests = new ArrayList<>();
    boolean fail = false;
    private int ids = 0;

    void reset() {
      script.clear();
      conversations.clear();
      requests.clear();
      fail = false;
    }

    ScriptedModel thenTool(String name, String inputJson) {
      try {
        JsonNode input = new ObjectMapper().readTree(inputJson);
        script.add(new Response(List.of(new ToolUse("toolu_" + (++ids), name, input)), "tool_use", 100, 20));
      } catch (Exception e) {
        throw new IllegalArgumentException(e);
      }
      return this;
    }

    ScriptedModel thenText(String text) {
      script.add(new Response(List.of(new Text(text)), "end_turn", 100, 30));
      return this;
    }

    @Override
    public boolean configured() {
      return true;
    }

    @Override
    public String model() {
      return "scripted-model";
    }

    @Override
    public Response send(Request request) {
      requests.add(request);
      conversations.add(List.copyOf(request.messages())); // the caller keeps appending to its list
      if (fail) {
        throw new ModelException("scripted failure");
      }
      Response next = script.poll();
      if (next == null) {
        throw new IllegalStateException("The test script ran out of model responses.");
      }
      return next;
    }

    /** The tool results the model was shown on its n-th call (1-based). */
    List<ToolResult> toolResultsSeenOnCall(int n) {
      List<Message> conversation = conversations.get(n - 1);
      List<ToolResult> results = new ArrayList<>();
      for (Block block : conversation.get(conversation.size() - 1).content()) {
        if (block instanceof ToolResult r) {
          results.add(r);
        }
      }
      return results;
    }

    /** The last user message of the n-th call, as text. */
    String lastUserTextOnCall(int n) {
      List<Message> conversation = conversations.get(n - 1);
      StringBuilder text = new StringBuilder();
      for (Block block : conversation.get(conversation.size() - 1).content()) {
        if (block instanceof Text t) {
          text.append(t.text());
        }
      }
      return text.toString();
    }
  }

  @TestConfiguration
  static class Config {
    @Bean
    @Primary
    ScriptedModel scriptedModel() {
      return new ScriptedModel();
    }
  }

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper json;
  @Autowired JdbcClient jdbc;
  @Autowired ScriptedModel model;

  @BeforeEach
  void resetScript() {
    model.reset();
  }

  // ------------------------------------------------------------------ helpers

  record Response2(int status, JsonNode body) {
    String code() {
      return body.path("code").asText(null);
    }
  }

  record User(String token, UUID id) {}

  private Response2 call(MockHttpServletRequestBuilder request) throws Exception {
    MockHttpServletResponse raw = mvc.perform(request).andReturn().getResponse();
    String text = raw.getContentAsString(StandardCharsets.UTF_8);
    return new Response2(raw.getStatus(), text.isBlank() ? json.createObjectNode() : json.readTree(text));
  }

  private static MockHttpServletRequestBuilder as(MockHttpServletRequestBuilder request, User user) {
    return request.header("Authorization", "Bearer " + user.token());
  }

  private User register() throws Exception {
    String body =
        "{\"email\":\"ai-" + UUID.randomUUID() + "@example.com\",\"password\":\"correct-horse-battery\"}";
    Response2 r = call(post("/api/auth/register").contentType(MediaType.APPLICATION_JSON).content(body));
    assertThat(r.status()).isEqualTo(201);
    return new User(r.body().get("accessToken").asText(), UUID.fromString(r.body().get("user").get("id").asText()));
  }

  /** A paying user holding 10 AAPL at $150 (15.0% of $10,000) and $8,500 cash. */
  private User subscriber() throws Exception {
    User user = register();
    jdbc.sql("UPDATE subscriptions SET status = 'active' WHERE user_id = ?").param(user.id()).update();
    tx(user, "{\"type\":\"DEPOSIT\",\"amount\":10000}");
    tx(user, "{\"type\":\"BUY\",\"ticker\":\"AAPL\",\"quantity\":10,\"price\":150}");
    return user;
  }

  private void tx(User user, String body) throws Exception {
    Response2 r =
        call(as(post("/api/ledger/transactions").contentType(MediaType.APPLICATION_JSON).content(body), user));
    assertThat(r.status()).isEqualTo(201);
  }

  private Response2 ask(User user, String question) throws Exception {
    String body = json.writeValueAsString(java.util.Map.of("question", question));
    return call(as(post("/api/ai/ask").contentType(MediaType.APPLICATION_JSON).content(body), user));
  }

  private JsonNode lastCall(User user) {
    String row =
        jdbc.sql(
                """
                SELECT row_to_json(c)::text FROM ai_calls c
                WHERE user_id = ? ORDER BY id DESC LIMIT 1
                """)
            .param(user.id())
            .query(String.class)
            .single();
    try {
      return json.readTree(row);
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }

  // -------------------------------------------------------------------- ask

  @Test
  void answersFromToolResultsAndVerifiesTheFigures() throws Exception {
    User user = subscriber();
    model.thenTool("get_portfolio", "{}")
        .thenText("Your only position is AAPL, worth $1,500.00, which is 15.0% of your $10,000.00 portfolio.");

    Response2 r = ask(user, "What do I hold?");

    assertThat(r.status()).isEqualTo(200);
    assertThat(r.body().get("answer").asText()).contains("AAPL").contains("$1,500.00");
    assertThat(r.body().get("sample").asBoolean()).isFalse();
    assertThat(r.body().get("checks").get("grounded").asBoolean()).isTrue();
    assertThat(r.body().get("checks").get("adviceBlocked").asBoolean()).isFalse();
    assertThat(r.body().get("sources").get(0).get("tool").asText()).isEqualTo("get_portfolio");
    assertThat(r.body().get("model").asText()).isEqualTo("scripted-model");
    assertThat(r.body().get("usage").get("modelTurns").asInt()).isEqualTo(2);
    assertThat(r.body().get("usage").get("inputTokens").asInt()).isEqualTo(200);

    // The model was offered the read-only tools and shown this user's real ledger data.
    assertThat(model.requests.get(0).tools()).extracting(ModelClient.ToolSpec::name)
        .containsExactly("get_portfolio", "get_risk", "get_stress_tests", "get_recent_transactions");
    JsonNode shown = json.readTree(model.toolResultsSeenOnCall(2).get(0).content());
    assertThat(shown.get("total_value").decimalValue()).isEqualByComparingTo("10000");
    assertThat(shown.get("cash_pct").decimalValue()).isEqualByComparingTo("85.0");
    assertThat(shown.get("positions").get(0).get("ticker").asText()).isEqualTo("AAPL");
    assertThat(shown.get("positions").get(0).get("weight_pct").decimalValue()).isEqualByComparingTo("15.0");

    // And the request was logged, without the answer's figures being flagged.
    JsonNode logged = lastCall(user);
    assertThat(logged.get("feature").asText()).isEqualTo("ask");
    assertThat(logged.get("status").asText()).isEqualTo("ok");
    assertThat(logged.get("model").asText()).isEqualTo("scripted-model");
    assertThat(logged.get("prompt_version").asText()).isEqualTo("ask-v1");
    assertThat(logged.get("grounded").asBoolean()).isTrue();
    assertThat(logged.get("tools").get(0).asText()).isEqualTo("get_portfolio");
    assertThat(logged.get("question").asText()).isEqualTo("What do I hold?");
  }

  @Test
  void anInventedFigureIsSentBackForARewrite() throws Exception {
    User user = subscriber();
    model.thenTool("get_portfolio", "{}")
        .thenText("AAPL is worth $9,999.")
        .thenText("AAPL is worth $1,500.00.");

    Response2 r = ask(user, "What is AAPL worth?");

    assertThat(r.status()).isEqualTo(200);
    assertThat(r.body().get("answer").asText()).isEqualTo("AAPL is worth $1,500.00.");
    assertThat(r.body().get("checks").get("grounded").asBoolean()).isTrue();
    assertThat(r.body().get("usage").get("modelTurns").asInt()).isEqualTo(3);
    // The third call told the model exactly which figure had no support.
    assertThat(model.lastUserTextOnCall(3)).contains("$9,999").contains("only figures from the data");
  }

  @Test
  void aFigureThatStaysInventedIsFlaggedNotHidden() throws Exception {
    User user = subscriber();
    model.thenTool("get_portfolio", "{}")
        .thenText("AAPL is worth $9,999.")
        .thenText("AAPL is worth $9,998 and up 40.0%.");

    Response2 r = ask(user, "What is AAPL worth?");

    assertThat(r.status()).isEqualTo(200);
    assertThat(r.body().get("checks").get("grounded").asBoolean()).isFalse();
    List<String> flagged = new ArrayList<>();
    r.body().get("checks").get("ungroundedFigures").forEach(n -> flagged.add(n.asText()));
    assertThat(flagged).containsExactly("$9,998", "40.0%");
    assertThat(lastCall(user).get("grounded").asBoolean()).isFalse();
    assertThat(lastCall(user).get("ungrounded").get(0).asText()).isEqualTo("$9,998");
  }

  @Test
  void adviceFromTheModelIsWithheld() throws Exception {
    User user = subscriber();
    model.thenText("You should sell your AAPL shares before earnings.");

    Response2 r = ask(user, "Should I sell AAPL?");

    assertThat(r.status()).isEqualTo(200);
    assertThat(r.body().get("answer").asText()).isEqualTo(AdviceGuard.DECLINED);
    assertThat(r.body().get("checks").get("adviceBlocked").asBoolean()).isTrue();
    assertThat(lastCall(user).get("advice_blocked").asBoolean()).isTrue();
    assertThat(lastCall(user).get("answer").asText()).doesNotContain("should sell");
  }

  @Test
  void toolFailuresAreReportedToTheModelInsteadOfCrashing() throws Exception {
    User user = subscriber();
    model.thenTool("delete_everything", "{}")
        .thenTool("get_risk", "{\"confidence\":\"0.99\",\"horizon_days\":10}")
        .thenTool("get_risk", "{\"confidence\":\"0.5\"}")
        .thenText("Risk figures are not available right now.");

    Response2 r = ask(user, "What is my value at risk?");

    assertThat(r.status()).isEqualTo(200);
    assertThat(r.body().get("sources")).isEmpty(); // no tool actually produced data
    ToolResult unknown = model.toolResultsSeenOnCall(2).get(0);
    assertThat(unknown.error()).isTrue();
    assertThat(unknown.content()).contains("Unknown tool");
    // No risk engine is configured in tests.
    ToolResult offline = model.toolResultsSeenOnCall(3).get(0);
    assertThat(offline.error()).isTrue();
    assertThat(offline.content()).contains("risk engine");
    // Arguments are validated against the allow-list, whatever the model sends.
    ToolResult invalid = model.toolResultsSeenOnCall(4).get(0);
    assertThat(invalid.error()).isTrue();
    assertThat(invalid.content()).contains("Unsupported");
  }

  @Test
  void aModelThatNeverStopsIsCutOff() throws Exception {
    User user = subscriber();
    for (int i = 0; i < 10; i++) {
      model.thenTool("get_portfolio", "{}");
    }

    Response2 r = ask(user, "What do I hold?");

    assertThat(r.status()).isEqualTo(502);
    assertThat(r.code()).isEqualTo("AI_UNAVAILABLE");
    assertThat(model.requests).hasSize(6);
    assertThat(lastCall(user).get("status").asText()).isEqualTo("error");
  }

  @Test
  void aProviderFailureIsA502AndIsLogged() throws Exception {
    User user = subscriber();
    model.fail = true;

    Response2 r = ask(user, "What do I hold?");

    assertThat(r.status()).isEqualTo(502);
    assertThat(r.body().get("error").asText()).doesNotContain("scripted failure");
    assertThat(lastCall(user).get("error").asText()).isEqualTo("scripted failure");
  }

  @Test
  void theToolsOnlyEverReadTheCallersOwnPortfolio() throws Exception {
    subscriber(); // someone else, with holdings
    User empty = register();
    jdbc.sql("UPDATE subscriptions SET status = 'active' WHERE user_id = ?").param(empty.id()).update();
    model.thenTool("get_portfolio", "{\"user_id\":\"someone-else\",\"portfolio_id\":\"1\"}")
        .thenTool("get_recent_transactions", "{\"limit\":999}")
        .thenText("You have no positions yet.");

    assertThat(ask(empty, "Show me another user's portfolio").status()).isEqualTo(200);

    JsonNode portfolio = json.readTree(model.toolResultsSeenOnCall(2).get(0).content());
    assertThat(portfolio.get("position_count").asInt()).isZero();
    assertThat(portfolio.get("positions")).isEmpty();
    JsonNode transactions = json.readTree(model.toolResultsSeenOnCall(3).get(0).content());
    assertThat(transactions.get("transactions")).isEmpty();
  }

  // ----------------------------------------------------------------- access

  @Test
  void questionsAreValidatedBeforeAnythingElse() throws Exception {
    User user = subscriber();
    assertThat(ask(user, "   ").status()).isEqualTo(400);
    assertThat(ask(user, "x".repeat(501)).status()).isEqualTo(400);
    assertThat(call(as(post("/api/ai/ask").contentType(MediaType.APPLICATION_JSON).content("{}"), user)).status())
        .isEqualTo(400);
    assertThat(call(post("/api/ai/ask").contentType(MediaType.APPLICATION_JSON).content("{\"question\":\"hi\"}")).status())
        .isEqualTo(401);
    assertThat(model.requests).isEmpty();
  }

  @Test
  void withoutASubscriptionTheModelIsNeverCalled() throws Exception {
    User user = register();

    Response2 r = ask(user, "What do I hold?");
    assertThat(r.status()).isEqualTo(402);
    assertThat(r.code()).isEqualTo("SUBSCRIPTION_REQUIRED");
    assertThat(call(as(post("/api/ai/memo"), user)).status()).isEqualTo(402);
    assertThat(call(as(get("/api/ai/status"), user)).body().get("mode").asText()).isEqualTo("locked");
    assertThat(model.requests).isEmpty();
  }

  @Test
  void theDailyLimitStopsFurtherRequests() throws Exception {
    User user = subscriber();
    Response2 status = call(as(get("/api/ai/status"), user));
    assertThat(status.body().get("mode").asText()).isEqualTo("live");
    assertThat(status.body().get("remainingToday").asInt()).isEqualTo(50);

    jdbc.sql(
            """
            INSERT INTO ai_calls (user_id, feature, prompt_version, model, status)
            SELECT ?, 'ask', 'ask-v1', 'scripted-model', 'ok' FROM generate_series(1, 50)
            """)
        .param(user.id())
        .update();

    Response2 r = ask(user, "What do I hold?");
    assertThat(r.status()).isEqualTo(429);
    assertThat(r.code()).isEqualTo("AI_LIMIT_REACHED");
    assertThat(model.requests).isEmpty();
  }

  @Test
  void demoAccountsGetSampleAnswersWithoutCallingTheModel() throws Exception {
    Response2 demo = call(post("/api/auth/demo"));
    User user = new User(demo.body().get("accessToken").asText(), null);

    Response2 status = call(as(get("/api/ai/status"), user));
    assertThat(status.body().get("mode").asText()).isEqualTo("sample");
    assertThat(status.body().get("suggestions")).hasSize(4);

    Response2 largest = ask(user, "What is my largest position?");
    assertThat(largest.status()).isEqualTo(200);
    assertThat(largest.body().get("sample").asBoolean()).isTrue();
    assertThat(largest.body().get("answer").asText())
        .contains("VOO").contains("$13,625.00").contains("19.7%").contains("$69,065.00");
    assertThat(largest.body().get("sources").get(0).get("label").asText()).isEqualTo("Your positions");
    assertThat(largest.body().hasNonNull("model")).isFalse();

    Response2 concentration = ask(user, "how concentrated is my portfolio");
    assertThat(concentration.body().get("answer").asText()).contains("57.3%").contains("9.4%");

    // Without a risk engine the risk questions say so instead of inventing figures.
    assertThat(ask(user, "What is my value at risk?").body().get("answer").asText()).contains("offline");

    Response2 other = ask(user, "Tell me a joke");
    assertThat(other.body().get("sample").asBoolean()).isTrue();
    assertThat(other.body().get("answer").asText()).contains("sample questions");

    Response2 memo = call(as(post("/api/ai/memo"), user));
    assertThat(memo.status()).isEqualTo(200);
    assertThat(memo.body().get("sample").asBoolean()).isTrue();
    assertThat(memo.body().get("sections").get(0).get("body").asText()).contains("$69,065.00");

    assertThat(model.requests).isEmpty();
  }

  // ------------------------------------------------------------------- memo

  @Test
  void memoIsParsedCheckedAndLogged() throws Exception {
    User user = subscriber();
    model.thenText(
        """
        ```json
        {"title": "Portfolio risk memo", "sections": [
          {"heading": "Overview", "body": "The portfolio is worth $10,000.00 with 85.0% in cash."},
          {"heading": "Concentration", "body": "AAPL is the only position at 15.0% of the total."},
          {"heading": "Risk", "body": "Risk figures are unavailable."},
          {"heading": "Stress tests", "body": "Stress test figures are unavailable."}
        ]}
        ```""");

    Response2 r = call(as(post("/api/ai/memo"), user));

    assertThat(r.status()).isEqualTo(200);
    assertThat(r.body().get("title").asText()).isEqualTo("Portfolio risk memo");
    assertThat(r.body().get("sections")).hasSize(4);
    assertThat(r.body().get("checks").get("grounded").asBoolean()).isTrue();
    assertThat(r.body().get("sample").asBoolean()).isFalse();
    // The data went in the user message; the risk parts were marked unavailable.
    assertThat(model.lastUserTextOnCall(1)).contains("\"ticker\":\"AAPL\"").contains("Risk data:\nunavailable");
    assertThat(model.requests.get(0).tools()).isEmpty();
    assertThat(lastCall(user).get("feature").asText()).isEqualTo("memo");
  }

  @Test
  void memoWithInventedFiguresIsRewrittenAndUnparseableOutputIsA502() throws Exception {
    User user = subscriber();
    model.thenText("{\"title\":\"Memo\",\"sections\":[{\"heading\":\"Overview\",\"body\":\"Worth $77,777.\"}]}")
        .thenText("{\"title\":\"Memo\",\"sections\":[{\"heading\":\"Overview\",\"body\":\"Worth $10,000.00.\"}]}");
    Response2 fixed = call(as(post("/api/ai/memo"), user));
    assertThat(fixed.status()).isEqualTo(200);
    assertThat(fixed.body().get("checks").get("grounded").asBoolean()).isTrue();
    assertThat(fixed.body().get("usage").get("modelTurns").asInt()).isEqualTo(2);

    model.reset();
    model.thenText("Sorry, here is your memo in prose instead.");
    Response2 broken = call(as(post("/api/ai/memo"), user));
    assertThat(broken.status()).isEqualTo(502);

    model.reset();
    User empty = register();
    jdbc.sql("UPDATE subscriptions SET status = 'active' WHERE user_id = ?").param(empty.id()).update();
    assertThat(call(as(post("/api/ai/memo"), empty)).status()).isEqualTo(400);
  }

  // ------------------------------------------------------- analysis and log

  @Test
  void theOlderAnalysisEndpointUsesTheSameClientAndLog() throws Exception {
    User user = subscriber();
    model.thenText("{\"classifications\":[{\"ticker\":\"AAPL\",\"assetClass\":\"US Equity\",\"sector\":\"Technology\"}],"
        + "\"observations\":[\"One position.\"],\"risks\":[\"Single-name exposure.\"]}");

    Response2 r = call(as(post("/api/analysis"), user));

    assertThat(r.status()).isEqualTo(200);
    assertThat(r.body().get("classifications").get(0).get("sector").asText()).isEqualTo("Technology");
    assertThat(model.lastUserTextOnCall(1)).contains("AAPL: 15.0% of portfolio");
    assertThat(lastCall(user).get("feature").asText()).isEqualTo("analysis");
  }

  @Test
  void usersCanReadTheirOwnCallLog() throws Exception {
    User user = subscriber();
    model.thenTool("get_portfolio", "{}").thenText("AAPL is 15.0% of the portfolio.");
    ask(user, "How big is AAPL?");

    JsonNode calls = call(as(get("/api/ai/calls"), user)).body().get("calls");
    assertThat(calls).hasSize(1);
    assertThat(calls.get(0).get("question").asText()).isEqualTo("How big is AAPL?");
    assertThat(calls.get(0).get("grounded").asBoolean()).isTrue();
    assertThat(calls.get(0).get("inputTokens").asInt()).isEqualTo(200);

    User other = register();
    assertThat(call(as(get("/api/ai/calls"), other)).body().get("calls")).isEmpty();
  }
}
