package com.motion.common;

import com.fasterxml.jackson.annotation.JsonInclude;

/** The one error shape every endpoint returns. */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record ErrorBody(String error, String code) {

  public static ErrorBody of(String error) {
    return new ErrorBody(error, null);
  }
}
