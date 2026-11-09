package com.motion.common;

import org.springframework.http.HttpStatus;

/**
 * An error the client is meant to see. Anything thrown as an ApiException
 * becomes a JSON body of {"error": message, "code": code} with this status;
 * any other exception becomes a generic 500 with no internal detail.
 */
public class ApiException extends RuntimeException {

  private final HttpStatus status;
  private final String code;

  public ApiException(HttpStatus status, String message) {
    this(status, message, null);
  }

  public ApiException(HttpStatus status, String message, String code) {
    super(message);
    this.status = status;
    this.code = code;
  }

  public HttpStatus status() {
    return status;
  }

  public String code() {
    return code;
  }

  public static ApiException badRequest(String message) {
    return new ApiException(HttpStatus.BAD_REQUEST, message);
  }

  public static ApiException notFound(String message) {
    return new ApiException(HttpStatus.NOT_FOUND, message);
  }

  public static ApiException unprocessable(String message, String code) {
    return new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, message, code);
  }
}
