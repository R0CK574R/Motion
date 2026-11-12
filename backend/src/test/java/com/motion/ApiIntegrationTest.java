package com.motion;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.motion.auth.TokenService;
import com.motion.common.ApiException;
import com.motion.ledger.LedgerService;
import com.motion.ledger.PostTransactionRequest;
import jakarta.servlet.http.Cookie;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataAccessException;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/**
 * Drives the real application (controllers, security, services, SQL) against
 * a real Postgres. Every test registers its own fresh user, so tests do not
 * depend on each other or on the order they run in.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class ApiIntegrationTest {

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper json;
  @Autowired JdbcClient jdbc;
  @Autowired LedgerService ledger;
  @Autowired TokenService tokens;

  // ------------------------------------------------------------------ helpers

  record Response(int status, JsonNode body, MockHttpServletResponse raw) {
    String code() {
      return body.path("code").asText(null);
    }
  }

  record User(String email, String password, String token, Cookie refresh, UUID id) {}

  private Response call(MockHttpServletRequestBuilder request) throws Exception {
    MockHttpServletResponse raw = mvc.perform(request).andReturn().getResponse();
    String text = raw.getContentAsString(StandardCharsets.UTF_8);
    JsonNode body = text.isBlank() ? json.createObjectNode() : json.readTree(text);
    return new Response(raw.getStatus(), body, raw);
  }

  private static MockHttpServletRequestBuilder as(MockHttpServletRequestBuilder request, User user) {
    return request.header("Authorization", "Bearer " + user.token());
  }

  private static MockHttpServletRequestBuilder body(MockHttpServletRequestBuilder request, String body) {
    return request.contentType(MediaType.APPLICATION_JSON).content(body);
  }

  private User register() throws Exception {
    String email = "user-" + UUID.randomUUID() + "@example.com";
    String password = "correct-horse-battery";
    Response r = call(body(post("/api/auth/register"), credentials(email, password)));
    assertThat(r.status()).isEqualTo(201);
    return new User(
        email,
        password,
        r.body().get("accessToken").asText(),
        r.raw().getCookie("motion_refresh"),
        UUID.fromString(r.body().get("user").get("id").asText()));
  }

  private static String credentials(String email, String password) {
    return "{\"email\":\"" + email + "\",\"password\":\"" + password + "\"}";
  }

  private Response postTx(User user, String body) throws Exception {
    return call(as(body(post("/api/ledger/transactions"), body), user));
  }

  private Response deposit(User user, String amount) throws Exception {
    Response r = postTx(user, "{\"type\":\"DEPOSIT\",\"amount\":" + amount + "}");
    assertThat(r.status()).isEqualTo(201);
    return r;
  }

  private Response trade(User user, String type, String ticker, String quantity, String price)
      throws Exception {
    return postTx(
        user,
        "{\"type\":\"" + type + "\",\"ticker\":\"" + ticker + "\",\"quantity\":" + quantity
            + ",\"price\":" + price + "}");
  }

  private JsonNode portfolio(User user) throws Exception {
    Response r = call(as(get("/api/portfolio"), user));
    assertThat(r.status()).isEqualTo(200);
    return r.body();
  }

  private static void assertMoney(JsonNode node, String expected) {
    assertThat(node).as("expected a number").isNotNull();
    assertThat(node.decimalValue()).isEqualByComparingTo(new BigDecimal(expected));
  }

  private static JsonNode holding(JsonNode portfolio, String ticker) {
    for (JsonNode h : portfolio.get("holdings")) {
      if (ticker.equals(h.get("ticker").asText())) {
        return h;
      }
    }
    return null;
  }

  // --------------------------------------------------------------------- auth

  @Test
  void healthIsPublicAndEverythingElseNeedsAToken() throws Exception {
    assertThat(call(get("/health")).body().get("ok").asBoolean()).isTrue();

    for (String path : List.of("/api/portfolio", "/api/ledger/transactions", "/api/risk", "/api/audit")) {
      Response r = call(get(path));
      assertThat(r.status()).as(path).isEqualTo(401);
      assertThat(r.body().get("error").asText()).isNotBlank();
    }
    Response forged = call(get("/api/portfolio").header("Authorization", "Bearer not.a.token"));
    assertThat(forged.status()).isEqualTo(401);
  }

  @Test
  void registerLoginAndAccount() throws Exception {
    User user = register();
    assertThat(user.refresh()).isNotNull();
    assertThat(user.refresh().isHttpOnly()).isTrue();
    assertThat(user.refresh().getPath()).isEqualTo("/api/auth");

    Response me = call(as(get("/api/auth/me"), user));
    assertThat(me.status()).isEqualTo(200);
    assertThat(me.body().get("user").get("email").asText()).isEqualTo(user.email());
    assertThat(me.body().get("user").get("isDemo").asBoolean()).isFalse();
    assertThat(me.body().get("subscription").get("status").asText()).isEqualTo("none");

    // The password is stored hashed, never as typed.
    String stored =
        jdbc.sql("SELECT password_hash FROM users WHERE id = ?").param(user.id()).query(String.class).single();
    assertThat(stored).startsWith("$2").doesNotContain(user.password());

    Response again = call(body(post("/api/auth/register"), credentials(user.email(), user.password())));
    assertThat(again.status()).isEqualTo(409);

    Response upper =
        call(body(post("/api/auth/login"), credentials(user.email().toUpperCase(), user.password())));
    assertThat(upper.status()).isEqualTo(200);
    assertThat(upper.body().get("accessToken").asText()).isNotBlank();

    // A wrong password and an unknown email are indistinguishable.
    Response wrong = call(body(post("/api/auth/login"), credentials(user.email(), "wrong-password")));
    Response unknown = call(body(post("/api/auth/login"), credentials("nobody@example.com", "wrong-password")));
    assertThat(wrong.status()).isEqualTo(401);
    assertThat(unknown.status()).isEqualTo(401);
    assertThat(wrong.body()).isEqualTo(unknown.body());
  }

  @Test
  void registrationValidatesInput() throws Exception {
    assertThat(call(body(post("/api/auth/register"), credentials("a@b.co", "short"))).status()).isEqualTo(400);
    assertThat(call(body(post("/api/auth/register"), credentials("not-an-email", "long-enough-pw"))).status())
        .isEqualTo(400);
    assertThat(call(body(post("/api/auth/register"), "{}")).status()).isEqualTo(400);
    assertThat(call(body(post("/api/auth/register"), "not json")).status()).isEqualTo(400);
  }

  @Test
  void refreshRotatesTheTokenAndDetectsReuse() throws Exception {
    User user = register();
    Cookie first = user.refresh();

    Response rotated = call(post("/api/auth/refresh").cookie(first));
    assertThat(rotated.status()).isEqualTo(200);
    Cookie second = rotated.raw().getCookie("motion_refresh");
    assertThat(second.getValue()).isNotEqualTo(first.getValue());

    // The new access token works.
    Response me =
        call(get("/api/auth/me").header("Authorization", "Bearer " + rotated.body().get("accessToken").asText()));
    assertThat(me.status()).isEqualTo(200);

    // Replaying the old token straight away is the "two tabs" race: refused,
    // but the newer token survives.
    assertThat(call(post("/api/auth/refresh").cookie(first)).status()).isEqualTo(401);
    Response third = call(post("/api/auth/refresh").cookie(second));
    assertThat(third.status()).isEqualTo(200);
    Cookie latest = third.raw().getCookie("motion_refresh");

    // Replaying it long after it was rotated looks like theft: every session ends.
    jdbc.sql("UPDATE refresh_tokens SET revoked_at = now() - interval '5 minutes' WHERE token_hash = ?")
        .param(tokens.hash(first.getValue()))
        .update();
    assertThat(call(post("/api/auth/refresh").cookie(first)).status()).isEqualTo(401);
    assertThat(call(post("/api/auth/refresh").cookie(latest)).status()).isEqualTo(401);

    assertThat(call(post("/api/auth/refresh")).status()).isEqualTo(401);
    assertThat(call(post("/api/auth/refresh").cookie(new Cookie("motion_refresh", "made-up"))).status())
        .isEqualTo(401);
  }

  @Test
  void logoutRevokesTheRefreshToken() throws Exception {
    User user = register();
    Response out = call(post("/api/auth/logout").cookie(user.refresh()));
    assertThat(out.status()).isEqualTo(204);
    assertThat(out.raw().getCookie("motion_refresh").getMaxAge()).isZero();
    assertThat(call(post("/api/auth/refresh").cookie(user.refresh())).status()).isEqualTo(401);
  }

  // ------------------------------------------------------------------- ledger

  @Test
  void newAccountStartsEmpty() throws Exception {
    User user = register();
    JsonNode p = portfolio(user);
    assertMoney(p.get("cash"), "0");
    assertThat(p.get("holdings")).isEmpty();
    assertThat(call(as(get("/api/ledger/transactions"), user)).body().get("transactions")).isEmpty();
  }

  @Test
  void holdingsAndCashAreDerivedFromTheJournal() throws Exception {
    User user = register();
    deposit(user, "10000");
    assertThat(trade(user, "BUY", "aapl", "10", "150").status()).isEqualTo(201);
    assertThat(trade(user, "BUY", "AAPL", "10", "170").status()).isEqualTo(201);
    Response sell = trade(user, "SELL", "AAPL", "5", "200");
    assertThat(sell.status()).isEqualTo(201);

    // The sale shows its three entries: cash in, cost out, gain recognised.
    JsonNode entries = sell.body().get("entries");
    assertThat(entries).hasSize(3);
    BigDecimal debits = BigDecimal.ZERO;
    BigDecimal credits = BigDecimal.ZERO;
    for (JsonNode e : entries) {
      if (e.has("debit")) debits = debits.add(e.get("debit").decimalValue());
      if (e.has("credit")) credits = credits.add(e.get("credit").decimalValue());
    }
    assertThat(debits).isEqualByComparingTo("1000");
    assertThat(credits).isEqualByComparingTo("1000");

    JsonNode p = portfolio(user);
    assertMoney(p.get("cash"), "7800"); // 10000 - 1500 - 1700 + 1000
    assertMoney(p.get("contributions"), "10000");
    assertMoney(p.get("realizedGain"), "200"); // 5 x (200 - average cost 160)
    assertThat(p.get("holdings")).hasSize(1);
    JsonNode aapl = holding(p, "AAPL");
    assertMoney(aapl.get("shares"), "15");
    assertMoney(aapl.get("cost"), "160");
    assertMoney(aapl.get("basis"), "2400");
    assertMoney(aapl.get("price"), "200"); // the latest trade

    JsonNode tb = call(as(get("/api/ledger/trial-balance"), user)).body();
    assertThat(tb.get("balanced").asBoolean()).isTrue();
    assertMoney(tb.get("total"), "0");
    assertMoney(tb.get("accounts").get("CASH"), "7800");
    assertMoney(tb.get("accounts").get("SECURITIES"), "2400");
    assertMoney(tb.get("accounts").get("CONTRIBUTIONS"), "-10000");
    assertMoney(tb.get("accounts").get("REALIZED_PNL"), "-200");

    JsonNode list = call(as(get("/api/ledger/transactions"), user)).body().get("transactions");
    assertThat(list).hasSize(4);
    assertThat(list.get(0).get("type").asText()).isEqualTo("SELL"); // newest first
    assertThat(list.get(0).get("reversible").asBoolean()).isTrue();
    assertThat(list.get(1).get("reversible").asBoolean()).isFalse(); // an older AAPL trade
    assertThat(list.get(3).get("type").asText()).isEqualTo("DEPOSIT");

    // Selling the rest leaves no position and no leftover cost.
    assertThat(trade(user, "SELL", "AAPL", "15", "100").status()).isEqualTo(201);
    JsonNode after = portfolio(user);
    assertThat(after.get("holdings")).isEmpty();
    assertMoney(after.get("cash"), "9300");
    assertMoney(after.get("realizedGain"), "-700"); // 200 - (2400 - 1500)
    assertMoney(call(as(get("/api/ledger/trial-balance"), user)).body().get("accounts").get("SECURITIES"), "0");
  }

  @Test
  void postingsThatWouldOverdrawAreRefused() throws Exception {
    User user = register();
    deposit(user, "1000");

    Response noCash = trade(user, "BUY", "MSFT", "10", "400");
    assertThat(noCash.status()).isEqualTo(422);
    assertThat(noCash.code()).isEqualTo("INSUFFICIENT_CASH");

    Response tooMuchOut = postTx(user, "{\"type\":\"WITHDRAWAL\",\"amount\":1000.01}");
    assertThat(tooMuchOut.code()).isEqualTo("INSUFFICIENT_CASH");

    assertThat(trade(user, "BUY", "MSFT", "2", "400").status()).isEqualTo(201);
    Response noShares = trade(user, "SELL", "MSFT", "3", "400");
    assertThat(noShares.status()).isEqualTo(422);
    assertThat(noShares.code()).isEqualTo("INSUFFICIENT_SHARES");
    assertThat(trade(user, "SELL", "NVDA", "1", "100").code()).isEqualTo("INSUFFICIENT_SHARES");

    // Nothing from the refused requests was written.
    assertMoney(portfolio(user).get("cash"), "200");
    assertThat(call(as(get("/api/ledger/transactions"), user)).body().get("transactions")).hasSize(2);
  }

  @Test
  void invalidTransactionsAreRejected() throws Exception {
    User user = register();
    for (String bad :
        List.of(
            "{\"type\":\"DEPOSIT\",\"amount\":-5}",
            "{\"type\":\"DEPOSIT\",\"amount\":10.001}",
            "{\"type\":\"DEPOSIT\"}",
            "{\"type\":\"REVERSAL\",\"amount\":5}",
            "{\"type\":\"TRANSFER\",\"amount\":5}",
            "{\"type\":\"BUY\",\"ticker\":\"NOT VALID\",\"quantity\":1,\"price\":1}",
            "{\"type\":\"BUY\",\"ticker\":\"AAPL\",\"quantity\":0,\"price\":1}",
            "{\"amount\":5}",
            "not json")) {
      assertThat(postTx(user, bad).status()).as(bad).isEqualTo(400);
    }
    assertThat(call(as(get("/api/ledger/transactions"), user)).body().get("transactions")).isEmpty();
  }

  @Test
  void idempotencyKeyMakesRetriesSafe() throws Exception {
    User user = register();
    String key = UUID.randomUUID().toString();
    String depositBody = "{\"type\":\"DEPOSIT\",\"amount\":500}";

    Response first =
        call(as(body(post("/api/ledger/transactions"), depositBody), user).header("Idempotency-Key", key));
    Response retry =
        call(as(body(post("/api/ledger/transactions"), depositBody), user).header("Idempotency-Key", key));

    assertThat(first.status()).isEqualTo(201);
    assertThat(retry.status()).isEqualTo(200);
    assertThat(retry.raw().getHeader("Idempotent-Replay")).isEqualTo("true");
    assertThat(retry.body().get("id")).isEqualTo(first.body().get("id"));
    assertMoney(portfolio(user).get("cash"), "500"); // deposited once, not twice

    Response differentBody =
        call(
            as(body(post("/api/ledger/transactions"), "{\"type\":\"DEPOSIT\",\"amount\":900}"), user)
                .header("Idempotency-Key", key));
    assertThat(differentBody.status()).isEqualTo(409);
    assertThat(differentBody.code()).isEqualTo("IDEMPOTENCY_KEY_REUSED");

    // Keys are per portfolio: another user may use the same key.
    User other = register();
    Response theirs =
        call(as(body(post("/api/ledger/transactions"), depositBody), other).header("Idempotency-Key", key));
    assertThat(theirs.status()).isEqualTo(201);
  }

  @Test
  void reversalUndoesATransactionWithoutDeletingIt() throws Exception {
    User user = register();
    Response dep = deposit(user, "1000");
    Response firstBuy = trade(user, "BUY", "JPM", "2", "100");
    Response secondBuy = trade(user, "BUY", "JPM", "3", "110");
    String depositId = dep.body().get("id").asText();
    String firstId = firstBuy.body().get("id").asText();
    String secondId = secondBuy.body().get("id").asText();

    // Only the latest trade in a ticker can be reversed.
    Response older = call(as(post("/api/ledger/transactions/" + firstId + "/reversal"), user));
    assertThat(older.status()).isEqualTo(422);
    assertThat(older.code()).isEqualTo("NOT_LATEST_TRADE");

    // The deposit has been partly spent, so reversing it would overdraw.
    Response spent = call(as(post("/api/ledger/transactions/" + depositId + "/reversal"), user));
    assertThat(spent.status()).isEqualTo(422);
    assertThat(spent.code()).isEqualTo("INSUFFICIENT_CASH");

    Response reversal = call(as(post("/api/ledger/transactions/" + secondId + "/reversal"), user));
    assertThat(reversal.status()).isEqualTo(201);
    assertThat(reversal.body().get("type").asText()).isEqualTo("REVERSAL");
    assertThat(reversal.body().get("reversesId").asText()).isEqualTo(secondId);
    String reversalId = reversal.body().get("id").asText();

    JsonNode p = portfolio(user);
    assertMoney(p.get("cash"), "800");
    assertMoney(holding(p, "JPM").get("shares"), "2");
    assertMoney(holding(p, "JPM").get("basis"), "200");

    // History keeps all four rows; the reversed one is flagged, not removed.
    JsonNode list = call(as(get("/api/ledger/transactions"), user)).body().get("transactions");
    assertThat(list).hasSize(4);
    assertThat(list.get(0).get("type").asText()).isEqualTo("REVERSAL");
    assertThat(list.get(1).get("reversed").asBoolean()).isTrue();
    assertThat(list.get(1).get("reversible").asBoolean()).isFalse();
    assertThat(list.get(2).get("reversible").asBoolean()).isTrue(); // first buy is the latest again

    assertThat(call(as(post("/api/ledger/transactions/" + secondId + "/reversal"), user)).status())
        .isEqualTo(409);
    assertThat(call(as(post("/api/ledger/transactions/" + reversalId + "/reversal"), user)).status())
        .isEqualTo(400);
    assertThat(call(as(post("/api/ledger/transactions/" + UUID.randomUUID() + "/reversal"), user)).status())
        .isEqualTo(404);

    // With the second buy undone, the first is reversible, and then the deposit.
    assertThat(call(as(post("/api/ledger/transactions/" + firstId + "/reversal"), user)).status())
        .isEqualTo(201);
    assertThat(call(as(post("/api/ledger/transactions/" + depositId + "/reversal"), user)).status())
        .isEqualTo(201);
    JsonNode empty = portfolio(user);
    assertMoney(empty.get("cash"), "0");
    assertMoney(empty.get("contributions"), "0");
    assertThat(empty.get("holdings")).isEmpty();
    assertThat(call(as(get("/api/ledger/trial-balance"), user)).body().get("balanced").asBoolean()).isTrue();
  }

  @Test
  void usersCannotSeeOrTouchEachOthersLedgers() throws Exception {
    User alice = register();
    User bob = register();
    String aliceTx = deposit(alice, "5000").body().get("id").asText();

    assertMoney(portfolio(bob).get("cash"), "0");
    assertThat(call(as(get("/api/ledger/transactions"), bob)).body().get("transactions")).isEmpty();
    assertThat(call(as(post("/api/ledger/transactions/" + aliceTx + "/reversal"), bob)).status())
        .isEqualTo(404);
    assertMoney(portfolio(alice).get("cash"), "5000");
  }

  @Test
  void theDatabaseItselfRefusesToAlterTheJournal() throws Exception {
    User user = register();
    String txId = deposit(user, "100").body().get("id").asText();

    assertThatThrownBy(
            () -> jdbc.sql("UPDATE ledger_entries SET amount = amount * 2 WHERE transaction_id = ?::uuid").param(txId).update())
        .isInstanceOf(DataAccessException.class)
        .hasMessageContaining("append-only");
    assertThatThrownBy(
            () -> jdbc.sql("DELETE FROM ledger_entries WHERE transaction_id = ?::uuid").param(txId).update())
        .isInstanceOf(DataAccessException.class);
    assertThatThrownBy(
            () -> jdbc.sql("DELETE FROM ledger_transactions WHERE id = ?::uuid").param(txId).update())
        .isInstanceOf(DataAccessException.class);
    assertThatThrownBy(
            () -> jdbc.sql("UPDATE ledger_transactions SET amount = 1 WHERE id = ?::uuid").param(txId).update())
        .isInstanceOf(DataAccessException.class);

    // A one-sided entry cannot be committed: debits must equal credits.
    assertThatThrownBy(
            () ->
                jdbc.sql(
                        """
                        INSERT INTO ledger_entries (transaction_id, portfolio_id, account, amount)
                        SELECT id, portfolio_id, 'CASH', 50 FROM ledger_transactions WHERE id = ?::uuid
                        """)
                    .param(txId)
                    .update())
        .isInstanceOf(DataAccessException.class)
        .hasMessageContaining("does not balance");

    assertThatThrownBy(() -> jdbc.sql("DELETE FROM audit_log").update())
        .isInstanceOf(DataAccessException.class);

    assertMoney(portfolio(user).get("cash"), "100");
  }

  @Test
  void simultaneousSellsCannotSellTheSameSharesTwice() throws Exception {
    User user = register();
    deposit(user, "1000");
    assertThat(trade(user, "BUY", "KO", "10", "60").status()).isEqualTo(201);

    int attempts = 6;
    ExecutorService pool = Executors.newFixedThreadPool(attempts);
    CountDownLatch start = new CountDownLatch(1);
    List<Future<Boolean>> results = new ArrayList<>();
    for (int i = 0; i < attempts; i++) {
      results.add(
          pool.submit(
              () -> {
                start.await();
                try {
                  ledger.post(user.id(), PostTransactionRequest.sell("KO", "10", "65"), null);
                  return true;
                } catch (ApiException e) {
                  return false;
                }
              }));
    }
    start.countDown();
    int succeeded = 0;
    for (Future<Boolean> f : results) {
      if (f.get()) succeeded++;
    }
    pool.shutdown();

    assertThat(succeeded).isEqualTo(1);
    JsonNode p = portfolio(user);
    assertThat(p.get("holdings")).isEmpty();
    assertMoney(p.get("cash"), "1050"); // 1000 - 600 + 650, exactly once
  }

  @Test
  void pricesCanBeUpdatedOnlyForHeldTickers() throws Exception {
    User user = register();
    deposit(user, "1000");
    trade(user, "BUY", "BRK.B", "1", "400");

    Response updated = call(as(body(put("/api/portfolio/prices/BRK.B"), "{\"price\":455.5}"), user));
    assertThat(updated.status()).isEqualTo(200);
    assertMoney(holding(updated.body(), "BRK.B").get("price"), "455.5");
    assertMoney(holding(updated.body(), "BRK.B").get("cost"), "400"); // cost is unaffected
    assertMoney(updated.body().get("cash"), "600");

    assertThat(call(as(body(put("/api/portfolio/prices/TSLA"), "{\"price\":1}"), user)).status()).isEqualTo(404);
    assertThat(call(as(body(put("/api/portfolio/prices/BRK.B"), "{\"price\":-1}"), user)).status()).isEqualTo(400);
    assertThat(call(as(body(put("/api/portfolio/prices/BRK.B"), "{}"), user)).status()).isEqualTo(400);
  }

  // ------------------------------------------------- demo, analysis, risk, audit

  @Test
  void demoAccountIsSeededThroughTheLedger() throws Exception {
    Response demo = call(post("/api/auth/demo"));
    assertThat(demo.status()).isEqualTo(201);
    assertThat(demo.body().get("isDemo").asBoolean()).isTrue();
    User user =
        new User(null, null, demo.body().get("accessToken").asText(), demo.raw().getCookie("motion_refresh"), null);

    JsonNode me = call(as(get("/api/auth/me"), user)).body().get("user");
    assertThat(me.get("isDemo").asBoolean()).isTrue();
    // A demo account has no password, so it cannot be signed into, not even
    // with the marker stored in place of a hash.
    for (String guess : new String[] {"!no-password", "", "demo"}) {
      Response login = call(body(post("/api/auth/login"), credentials(me.get("email").asText(), guess)));
      assertThat(login.status()).isIn(400, 401);
    }

    JsonNode p = portfolio(user);
    assertMoney(p.get("cash"), "6500");
    assertThat(p.get("holdings")).hasSize(7);
    BigDecimal total = p.get("cash").decimalValue();
    for (JsonNode h : p.get("holdings")) {
      total = total.add(h.get("shares").decimalValue().multiply(h.get("price").decimalValue()));
    }
    assertThat(total).isEqualByComparingTo("69065");
    assertMoney(holding(p, "NVDA").get("cost"), "48");
    assertMoney(holding(p, "NVDA").get("price"), "138");

    assertThat(call(as(get("/api/ledger/transactions"), user)).body().get("transactions")).hasSize(8);
    assertThat(call(as(get("/api/ledger/trial-balance"), user)).body().get("balanced").asBoolean()).isTrue();

    // Demo accounts get the canned analysis without a subscription.
    Response analysis = call(as(post("/api/analysis"), user));
    assertThat(analysis.status()).isEqualTo(200);
    assertThat(analysis.body().get("classifications")).hasSize(7);

    // No risk engine is configured in tests, so the endpoint degrades cleanly.
    Response risk = call(as(get("/api/risk"), user));
    assertThat(risk.status()).isEqualTo(503);
    assertThat(risk.code()).isEqualTo("RISK_ENGINE_UNAVAILABLE");
    assertThat(call(as(get("/api/risk?confidence=0.5"), user)).status()).isEqualTo(400);
    assertThat(call(as(get("/api/risk?horizon=abc"), user)).status()).isEqualTo(400);
  }

  @Test
  void analysisIsPaywalledOnTheServerAndUnlockedByAVerifiedWebhook() throws Exception {
    User user = register();
    deposit(user, "100");
    trade(user, "BUY", "KO", "1", "60");

    Response locked = call(as(post("/api/analysis"), user));
    assertThat(locked.status()).isEqualTo(402);
    assertThat(locked.code()).isEqualTo("SUBSCRIPTION_REQUIRED");

    String event =
        "{\"type\":\"checkout.session.completed\",\"data\":{\"object\":{\"client_reference_id\":\""
            + user.id() + "\",\"customer\":\"cus_test\",\"subscription\":\"sub_" + user.id() + "\"}}}";

    // An unsigned or wrongly signed webhook changes nothing.
    assertThat(call(body(post("/api/billing/webhook"), event)).status()).isEqualTo(400);
    assertThat(
            call(body(post("/api/billing/webhook"), event).header("Stripe-Signature", sign(event, "wrong-secret")))
                .status())
        .isEqualTo(400);
    assertThat(call(as(post("/api/analysis"), user)).status()).isEqualTo(402);

    Response accepted =
        call(body(post("/api/billing/webhook"), event).header("Stripe-Signature", sign(event, "whsec_test_secret")));
    assertThat(accepted.status()).isEqualTo(200);
    assertThat(call(as(get("/api/auth/me"), user)).body().get("subscription").get("status").asText())
        .isEqualTo("active");

    // Past the paywall now. No AI key is configured in tests, so it stops there.
    Response unlocked = call(as(post("/api/analysis"), user));
    assertThat(unlocked.status()).isEqualTo(500);
    assertThat(unlocked.body().get("error").asText()).contains("AI provider key");

    String cancelled =
        "{\"type\":\"customer.subscription.deleted\",\"data\":{\"object\":{\"id\":\"sub_" + user.id()
            + "\",\"status\":\"canceled\",\"current_period_end\":1767225600}}}";
    assertThat(
            call(body(post("/api/billing/webhook"), cancelled)
                    .header("Stripe-Signature", sign(cancelled, "whsec_test_secret")))
                .status())
        .isEqualTo(200);
    assertThat(call(as(post("/api/analysis"), user)).status()).isEqualTo(402);
  }

  /** Builds a Stripe-Signature header the way Stripe does: HMAC-SHA256 of "timestamp.payload". */
  private static String sign(String payload, String secret) throws Exception {
    long timestamp = System.currentTimeMillis() / 1000;
    Mac mac = Mac.getInstance("HmacSHA256");
    mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
    byte[] digest = mac.doFinal((timestamp + "." + payload).getBytes(StandardCharsets.UTF_8));
    return "t=" + timestamp + ",v1=" + HexFormat.of().formatHex(digest);
  }

  @Test
  void actionsAreAuditedAndTheAdminViewIsRoleProtected() throws Exception {
    User user = register();
    deposit(user, "250");
    call(body(post("/api/auth/login"), credentials(user.email(), "wrong-password")));

    JsonNode events = call(as(get("/api/audit"), user)).body().get("events");
    List<String> actions = new ArrayList<>();
    for (JsonNode e : events) {
      actions.add(e.get("action").asText());
      assertThat(e.get("userId").asText()).isEqualTo(user.id().toString());
    }
    assertThat(actions).contains("REGISTER", "LEDGER_POST", "LOGIN_FAILURE");
    JsonNode posting = null;
    for (JsonNode e : events) {
      if ("LEDGER_POST".equals(e.get("action").asText())) posting = e;
    }
    assertThat(posting.get("detail").get("type").asText()).isEqualTo("DEPOSIT");
    assertThat(posting.get("detail").get("amount").asText()).isEqualTo("250.00");

    // An ordinary user is refused the all-users view.
    assertThat(call(as(get("/api/admin/audit"), user)).status()).isEqualTo(403);

    // The role lives in the token, so an admin gets it at their next sign-in.
    jdbc.sql("UPDATE users SET role = 'ADMIN' WHERE id = ?").param(user.id()).update();
    Response login = call(body(post("/api/auth/login"), credentials(user.email(), user.password())));
    Response admin =
        call(get("/api/admin/audit").header("Authorization", "Bearer " + login.body().get("accessToken").asText()));
    assertThat(admin.status()).isEqualTo(200);
    assertThat(admin.body().get("events")).isNotEmpty();
  }

  // --------------------------------------------------------------------- CORS

  @Test
  void onlyTheFrontendOriginPassesCors() throws Exception {
    MockHttpServletResponse allowed =
        mvc.perform(
                options("/api/portfolio")
                    .header("Origin", "http://localhost:5173")
                    .header("Access-Control-Request-Method", "GET")
                    .header("Access-Control-Request-Headers", "authorization"))
            .andReturn()
            .getResponse();
    assertThat(allowed.getStatus()).isEqualTo(200);
    assertThat(allowed.getHeader("Access-Control-Allow-Origin")).isEqualTo("http://localhost:5173");
    assertThat(allowed.getHeader("Access-Control-Allow-Credentials")).isEqualTo("true");

    MockHttpServletResponse refused =
        mvc.perform(
                options("/api/portfolio")
                    .header("Origin", "https://evil.example")
                    .header("Access-Control-Request-Method", "GET"))
            .andReturn()
            .getResponse();
    assertThat(refused.getStatus()).isEqualTo(403);
    assertThat(refused.getHeader("Access-Control-Allow-Origin")).isNull();
  }
}
