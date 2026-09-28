package dev.arc.api;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonPropertyOrder;
import dev.arc.error.ArcException;
import java.util.List;

/**
 * The one JSON error envelope, written by the exception handlers and by the request-size filter:
 * {@code status}, {@code message}, {@code issues} and {@code locations}, in that order on every
 * JVM. Application errors carry their graph locations (an empty list outside a graph); the 413 of
 * the request filter, which the web server mirrors, has no locations field.
 */
@JsonPropertyOrder({"status", "message", "issues", "locations"})
record ErrorBody(
    int status,
    String message,
    List<String> issues,
    @JsonInclude(JsonInclude.Include.NON_NULL) List<ArcException.Location> locations) {
  static ErrorBody of(ArcException error) {
    return new ErrorBody(error.status(), error.getMessage(), error.issues(), error.locations());
  }

  /** An error outside any graph: the issues are given and the locations are empty. */
  static ErrorBody outsideGraph(int status, String message, List<String> issues) {
    return new ErrorBody(status, message, issues, List.of());
  }

  /** A transport error, which has no locations field at all. */
  static ErrorBody transport(int status, String message) {
    return new ErrorBody(status, message, List.of(), null);
  }
}
