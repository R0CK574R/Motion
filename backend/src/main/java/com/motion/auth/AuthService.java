package com.motion.auth;

import com.motion.audit.AuditService;
import com.motion.common.ApiException;
import com.motion.ledger.DemoPortfolio;
import com.motion.ledger.LedgerService;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.HexFormat;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

@Service
public class AuthService {

  /** What a successful sign-in hands back to the controller. */
  public record Session(String accessToken, String refreshToken, UUID userId, String email) {}

  public record Account(
      UUID id, String email, boolean demo, String subscriptionStatus, Instant currentPeriodEnd) {}

  private record UserRow(UUID id, String email, String passwordHash, String role) {}

  private record RefreshRow(UUID id, UUID userId, Instant expiresAt, boolean revoked, Instant revokedAt) {}

  private static final Pattern EMAIL = Pattern.compile("^\\S+@\\S+\\.\\S+$");

  /**
   * Two tabs can present the same refresh token at the same moment; the loser
   * of that race is harmless. A revoked token showing up later than this is
   * treated as stolen.
   */
  private static final Duration REUSE_GRACE = Duration.ofSeconds(10);

  private final JdbcClient jdbc;
  private final TransactionTemplate tx;
  private final PasswordEncoder passwords;
  private final TokenService tokens;
  private final LedgerService ledger;
  private final AuditService audit;
  private final String dummyHash;
  private final java.security.SecureRandom random = new java.security.SecureRandom();

  public AuthService(
      JdbcClient jdbc,
      TransactionTemplate tx,
      PasswordEncoder passwords,
      TokenService tokens,
      LedgerService ledger,
      AuditService audit) {
    this.jdbc = jdbc;
    this.tx = tx;
    this.passwords = passwords;
    this.tokens = tokens;
    this.ledger = ledger;
    this.audit = audit;
    // Compared against when the email is unknown, so a wrong email costs the
    // same time as a wrong password and the two cannot be told apart.
    this.dummyHash = passwords.encode("not-a-real-password");
  }

  public Session register(String rawEmail, String password) {
    if (rawEmail == null || !EMAIL.matcher(rawEmail).matches() || password == null || password.length() < 8) {
      throw ApiException.badRequest(
          "Valid email and a password of at least 8 characters are required.");
    }
    if (password.length() > 200) {
      throw ApiException.badRequest("Password must be 200 characters or fewer.");
    }
    String email = rawEmail.toLowerCase();
    String hash = passwords.encode(password); // slow by design; done outside the transaction

    UUID userId;
    try {
      userId = tx.execute(status -> createUser(email, hash, false));
    } catch (DuplicateKeyException e) {
      throw new ApiException(HttpStatus.CONFLICT, "An account with that email already exists.");
    }
    audit.record(userId, "REGISTER", Map.of());
    return issueSession(userId, email, "USER");
  }

  public Session login(String rawEmail, String password) {
    if (rawEmail == null || !EMAIL.matcher(rawEmail).matches() || password == null) {
      throw ApiException.badRequest("Email and password are required.");
    }
    String email = rawEmail.toLowerCase();
    Optional<UserRow> user =
        jdbc.sql("SELECT id, email, password_hash, role FROM users WHERE email = ?")
            .param(email)
            .query(
                (rs, i) ->
                    new UserRow(
                        rs.getObject("id", UUID.class),
                        rs.getString("email"),
                        rs.getString("password_hash"),
                        rs.getString("role")))
            .optional();

    boolean valid = passwords.matches(password, user.map(UserRow::passwordHash).orElse(dummyHash));
    if (user.isEmpty() || !valid) {
      audit.record(user.map(UserRow::id).orElse(null), "LOGIN_FAILURE", Map.of());
      throw new ApiException(HttpStatus.UNAUTHORIZED, "Invalid email or password.");
    }
    audit.record(user.get().id(), "LOGIN_SUCCESS", Map.of());
    return issueSession(user.get().id(), user.get().email(), user.get().role());
  }

  /**
   * Swaps a refresh token for a new one (rotation). Empty means the token was
   * missing, expired or already used, and the caller must sign in again.
   */
  public Optional<Session> refresh(String rawToken) {
    if (rawToken == null || rawToken.isBlank()) {
      return Optional.empty();
    }
    String hash = tokens.hash(rawToken);
    return tx.execute(
        status -> {
          // FOR UPDATE: two requests carrying the same token queue up here, so
          // only one of them can rotate it.
          Optional<RefreshRow> found =
              jdbc.sql(
                      """
                      SELECT id, user_id, expires_at, revoked, revoked_at
                      FROM refresh_tokens WHERE token_hash = ? FOR UPDATE
                      """)
                  .param(hash)
                  .query(
                      (rs, i) ->
                          new RefreshRow(
                              rs.getObject("id", UUID.class),
                              rs.getObject("user_id", UUID.class),
                              rs.getTimestamp("expires_at").toInstant(),
                              rs.getBoolean("revoked"),
                              rs.getTimestamp("revoked_at") == null
                                  ? null
                                  : rs.getTimestamp("revoked_at").toInstant()))
                  .optional();
          if (found.isEmpty()) {
            return Optional.<Session>empty();
          }
          RefreshRow row = found.get();
          Instant now = Instant.now();

          if (row.revoked()) {
            boolean withinGrace =
                row.revokedAt() != null && row.revokedAt().plus(REUSE_GRACE).isAfter(now);
            if (!withinGrace) {
              // A token that was already rotated is being replayed: assume it
              // was stolen and end every session this user has.
              revokeAll(row.userId());
              audit.record(row.userId(), "REFRESH_TOKEN_REUSE", Map.of());
            }
            return Optional.<Session>empty();
          }
          if (row.expiresAt().isBefore(now)) {
            return Optional.<Session>empty();
          }

          jdbc.sql("UPDATE refresh_tokens SET revoked = true, revoked_at = now() WHERE id = ?")
              .param(row.id())
              .update();
          UserRow user =
              jdbc.sql("SELECT id, email, password_hash, role FROM users WHERE id = ?")
                  .param(row.userId())
                  .query(
                      (rs, i) ->
                          new UserRow(
                              rs.getObject("id", UUID.class),
                              rs.getString("email"),
                              rs.getString("password_hash"),
                              rs.getString("role")))
                  .single();
          return Optional.of(issueSession(user.id(), user.email(), user.role()));
        });
  }

  public void logout(String rawToken) {
    if (rawToken == null || rawToken.isBlank()) {
      return;
    }
    jdbc.sql(
            """
            UPDATE refresh_tokens SET revoked = true, revoked_at = now()
            WHERE token_hash = ? AND revoked = false
            """)
        .param(tokens.hash(rawToken))
        .update();
  }

  /**
   * One-click demo: a throwaway account with a seeded portfolio, so a visitor
   * never meets a sign-up wall. Each visitor gets their own, and accounts
   * older than a day are removed on the way in.
   */
  public Session startDemo() {
    String email = "demo+" + UUID.randomUUID() + "@motion.invalid";
    byte[] secret = new byte[24];
    random.nextBytes(secret);
    // An unguessable password nobody is told: the account is reachable only
    // through this endpoint, never by signing in.
    String hash = passwords.encode(HexFormat.of().formatHex(secret));

    UUID userId =
        tx.execute(
            status -> {
              jdbc.sql(
                      "DELETE FROM users WHERE is_demo = true AND created_at < now() - interval '24 hours'")
                  .update();
              UUID id = createUser(email, hash, true);
              DemoPortfolio.seed(ledger, id);
              return id;
            });
    audit.record(userId, "DEMO_START", Map.of());
    return issueSession(userId, email, "USER");
  }

  public Account account(UUID userId) {
    return jdbc.sql(
            """
            SELECT u.id, u.email, u.is_demo, s.status, s.current_period_end
            FROM users u LEFT JOIN subscriptions s ON s.user_id = u.id
            WHERE u.id = ?
            """)
        .param(userId)
        .query(
            (rs, i) ->
                new Account(
                    rs.getObject("id", UUID.class),
                    rs.getString("email"),
                    rs.getBoolean("is_demo"),
                    rs.getString("status") == null ? "none" : rs.getString("status"),
                    rs.getTimestamp("current_period_end") == null
                        ? null
                        : rs.getTimestamp("current_period_end").toInstant()))
        .optional()
        .orElseThrow(() -> ApiException.notFound("User not found."));
  }

  /** Must run inside a transaction: the three rows belong together. */
  private UUID createUser(String email, String passwordHash, boolean demo) {
    UUID userId =
        jdbc.sql("INSERT INTO users (email, password_hash, is_demo) VALUES (?, ?, ?) RETURNING id")
            .params(email, passwordHash, demo)
            .query((rs, i) -> rs.getObject(1, UUID.class))
            .single();
    jdbc.sql("INSERT INTO portfolios (user_id) VALUES (?)").param(userId).update();
    jdbc.sql("INSERT INTO subscriptions (user_id, status) VALUES (?, 'none')").param(userId).update();
    return userId;
  }

  private Session issueSession(UUID userId, String email, String role) {
    TokenService.RefreshToken refresh = tokens.newRefreshToken();
    jdbc.sql("INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)")
        .params(userId, refresh.hash(), Timestamp.from(refresh.expiresAt()))
        .update();
    return new Session(tokens.signAccessToken(userId, role), refresh.raw(), userId, email);
  }

  private void revokeAll(UUID userId) {
    jdbc.sql(
            """
            UPDATE refresh_tokens SET revoked = true, revoked_at = now()
            WHERE user_id = ? AND revoked = false
            """)
        .param(userId)
        .update();
  }
}
