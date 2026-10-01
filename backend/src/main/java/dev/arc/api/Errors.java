package dev.arc.api;

import dev.arc.error.ArcException;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
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
  ResponseEntity<ErrorBody> arc(ArcException e) {
    return response(ErrorBody.of(e));
  }

  @ExceptionHandler({
    HttpMessageNotReadableException.class,
    MethodArgumentTypeMismatchException.class
  })
  ResponseEntity<ErrorBody> malformed() {
    return response(
        ErrorBody.outsideGraph(
            400, "Request contains malformed JSON or an invalid value", List.of()));
  }

  /**
   * Spring's own errors keep the headers their status calls for: Allow on a 405, and Accept on a
   * 415 or 406.
   */
  @ExceptionHandler(Exception.class)
  ResponseEntity<ErrorBody> unexpected(Exception e) {
    if (e instanceof ErrorResponse error)
      return response(
          ErrorBody.outsideGraph(
              error.getStatusCode().value(), error.getBody().getDetail(), List.of()),
          error.getHeaders());
    LOG.error("Unhandled request error", e);
    return response(ErrorBody.outsideGraph(500, "An unexpected server error occurred", List.of()));
  }

  private static ResponseEntity<ErrorBody> response(ErrorBody body) {
    return response(body, HttpHeaders.EMPTY);
  }

  /**
   * The JSON error body with its real status, whatever the client's Accept header: a preset content
   * type skips negotiation, which failed inside the handler and turned every error into an empty
   * 500 for a client that accepts only text.
   */
  private static ResponseEntity<ErrorBody> response(ErrorBody body, HttpHeaders headers) {
    return ResponseEntity.status(body.status())
        .headers(headers)
        .contentType(MediaType.APPLICATION_JSON)
        .body(body);
  }
}
