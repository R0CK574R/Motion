package com.motion.common;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

/** Turns exceptions into the JSON error shape. Stack traces never reach the client. */
@RestControllerAdvice
public class GlobalExceptionHandler {

  private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

  @ExceptionHandler(ApiException.class)
  public ResponseEntity<ErrorBody> api(ApiException ex) {
    return ResponseEntity.status(ex.status()).body(new ErrorBody(ex.getMessage(), ex.code()));
  }

  @ExceptionHandler({
    HttpMessageNotReadableException.class,
    MethodArgumentTypeMismatchException.class,
    MissingServletRequestParameterException.class,
    HttpMediaTypeNotSupportedException.class
  })
  public ResponseEntity<ErrorBody> malformed(Exception ex) {
    return ResponseEntity.badRequest().body(ErrorBody.of("Malformed request."));
  }

  @ExceptionHandler(NoResourceFoundException.class)
  public ResponseEntity<ErrorBody> notFound(NoResourceFoundException ex) {
    return ResponseEntity.status(HttpStatus.NOT_FOUND).body(ErrorBody.of("Not found"));
  }

  @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
  public ResponseEntity<ErrorBody> wrongMethod(HttpRequestMethodNotSupportedException ex) {
    return ResponseEntity.status(HttpStatus.METHOD_NOT_ALLOWED)
        .body(ErrorBody.of("Method not allowed"));
  }

  @ExceptionHandler(Exception.class)
  public ResponseEntity<ErrorBody> unexpected(Exception ex) {
    log.error("Unhandled error", ex);
    return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
        .body(ErrorBody.of("Internal server error"));
  }
}
