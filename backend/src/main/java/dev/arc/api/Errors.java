package dev.arc.api;

import dev.arc.error.ArcException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.ErrorResponse;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

@RestControllerAdvice
public class Errors {
  private static final Logger LOG = LoggerFactory.getLogger(Errors.class);

  @ExceptionHandler(ArcException.class)
  ResponseEntity<Map<String, Object>> arc(ArcException e) {
    return response(e.status(), e.getMessage(), e.issues(), e.locations());
  }

  @ExceptionHandler({
    HttpMessageNotReadableException.class,
    MethodArgumentTypeMismatchException.class
  })
  ResponseEntity<Map<String, Object>> malformed() {
    return response(
        400, "Request contains malformed JSON or an invalid value", List.of(), List.of());
  }

  @ExceptionHandler(Exception.class)
  ResponseEntity<Map<String, Object>> unexpected(Exception e) {
    if (e instanceof ErrorResponse error)
      return response(
          error.getStatusCode().value(), error.getBody().getDetail(), List.of(), List.of());
    LOG.error("Unhandled request error", e);
    return response(500, "An unexpected server error occurred", List.of(), List.of());
  }

  /**
   * The JSON error body with its real status, whatever the client's Accept header: a preset content
   * type skips negotiation, which failed inside the handler and turned every error into an empty
   * 500 for a client that accepts only text. The fields keep one order on every JVM.
   */
  private static ResponseEntity<Map<String, Object>> response(
      int status, String message, List<String> issues, List<ArcException.Location> locations) {
    var body = new LinkedHashMap<String, Object>();
    body.put("status", status);
    body.put("message", message);
    body.put("issues", issues);
    body.put("locations", locations);
    return ResponseEntity.status(status).contentType(MediaType.APPLICATION_JSON).body(body);
  }
}
