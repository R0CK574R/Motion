package com.motion.auth;

import java.util.UUID;
import org.springframework.security.oauth2.jwt.Jwt;

public final class CurrentUser {

  private CurrentUser() {}

  /** The signed-in user's id, taken from the verified token's subject. */
  public static UUID id(Jwt jwt) {
    return UUID.fromString(jwt.getSubject());
  }
}
