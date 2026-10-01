package dev.arc.api;

import com.fasterxml.jackson.databind.exc.UnrecognizedPropertyException;
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
  private static final int NAMED_FIELD_CHARACTERS = 200;

  @ExceptionHandler(ArcException.class)
  ResponseEntity<ErrorBody> arc(ArcException e) {
    return response(ErrorBody.of(e));
  }

  @ExceptionHandler({
    HttpMessageNotReadableException.class,
    MethodArgumentTypeMismatchException.class
  })
  ResponseEntity<ErrorBody> malformed(Exception e) {
    String message =
        e.getCause() instanceof UnrecognizedPropertyException unknown
            ? unknownField(unknown)
            : "Request contains malformed JSON or an invalid value";
    return response(ErrorBody.outsideGraph(400, message, List.of()));
  }

  /**
   * Where the unknown field is, as in definition.inputs[0].source.pointr, so that a misspelling is
   * found; a path too long to repeat is left out.
   */
  private static String unknownField(UnrecognizedPropertyException error) {
    var path = new StringBuilder();
    for (var reference : error.getPath())
      if (reference.getFieldName() == null)
        path.append('[').append(reference.getIndex()).append(']');
      else path.append(path.isEmpty() ? "" : ".").append(reference.getFieldName());
    return path.length() <= NAMED_FIELD_CHARACTERS
        ? "Request contains an unknown field: " + path
        : "Request contains an unknown field";
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
