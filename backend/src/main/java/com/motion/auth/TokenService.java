package com.motion.auth;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.HexFormat;
import java.util.UUID;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.stereotype.Service;

/**
 * Two kinds of token:
 *
 * <ul>
 *   <li>Access token: a signed JWT, valid for 15 minutes, held in browser memory.
 *   <li>Refresh token: 48 random bytes, valid for 30 days, kept in an httpOnly
 *       cookie. Only its SHA-256 hash is stored, so a leaked database dump
 *       does not hand out live sessions.
 * </ul>
 */
@Service
public class TokenService {

  public static final Duration ACCESS_TTL = Duration.ofMinutes(15);
  public static final Duration REFRESH_TTL = Duration.ofDays(30);

  public record RefreshToken(String raw, String hash, Instant expiresAt) {}

  private final JwtEncoder encoder;
  private final SecureRandom random = new SecureRandom();

  public TokenService(JwtEncoder encoder) {
    this.encoder = encoder;
  }

  public String signAccessToken(UUID userId, String role) {
    Instant now = Instant.now();
    JwtClaimsSet claims =
        JwtClaimsSet.builder()
            .subject(userId.toString())
            .issuedAt(now)
            .expiresAt(now.plus(ACCESS_TTL))
            .claim("role", role)
            .build();
    JwsHeader header = JwsHeader.with(MacAlgorithm.HS256).build();
    return encoder.encode(JwtEncoderParameters.from(header, claims)).getTokenValue();
  }

  public RefreshToken newRefreshToken() {
    byte[] bytes = new byte[48];
    random.nextBytes(bytes);
    String raw = HexFormat.of().formatHex(bytes);
    return new RefreshToken(raw, hash(raw), Instant.now().plus(REFRESH_TTL));
  }

  public String hash(String rawToken) {
    try {
      MessageDigest digest = MessageDigest.getInstance("SHA-256");
      return HexFormat.of().formatHex(digest.digest(rawToken.getBytes(StandardCharsets.UTF_8)));
    } catch (NoSuchAlgorithmException e) {
      throw new IllegalStateException(e); // SHA-256 is required of every JVM
    }
  }
}
