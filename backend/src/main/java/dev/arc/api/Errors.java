package dev.arc.api;

import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.ErrorResponse;

@RestControllerAdvice
public class Errors {
    private static final Logger LOG = LoggerFactory.getLogger(Errors.class);
    @ExceptionHandler(ArcException.class)
    ResponseEntity<?> arc(ArcException e) { return response(e.status(), e.getMessage(), e.issues()); }
    @ExceptionHandler(DuplicateKeyException.class)
    ResponseEntity<?> conflict() { return response(409, "This rule ID already exists", List.of()); }
    @ExceptionHandler({HttpMessageNotReadableException.class, MethodArgumentTypeMismatchException.class})
    ResponseEntity<?> malformed() { return response(400, "Request contains malformed JSON or an invalid value", List.of()); }
    @ExceptionHandler(Exception.class)
    ResponseEntity<?> unexpected(Exception e) {
        if (e instanceof ErrorResponse error) return response(error.getStatusCode().value(), error.getBody().getDetail(), List.of());
        LOG.error("Unhandled request error", e);
        return response(500, "An unexpected server error occurred", List.of());
    }
    private ResponseEntity<?> response(int status, String message, List<String> issues) {
        return ResponseEntity.status(status).body(Map.of("status", status, "message", message, "issues", issues));
    }
}
