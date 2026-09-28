package dev.arc.error;

import java.util.*;

public class ArcException extends RuntimeException {
  public record Location(String ruleId, Integer version, String nodeId, String label) {}

  /**
   * Why an operation failed. Expression fallbacks ({@code IFERROR}, {@code ISERROR}), source {@code
   * DEFAULT} policies and field context handle only {@link #recoverable()} kinds. The kind is
   * internal: HTTP responses expose only the status, message, issues and locations.
   */
  public enum Kind {
    /**
     * An invalid value, argument, definition or request. Errors created by the public constructors
     * with a status other than 504, such as 404 or 409, also have this kind.
     */
    INVALID,
    /** An Excel function reported #N/A (no value was found); {@code ISNA} tests for this kind. */
    NOT_AVAILABLE,
    /** An execution budget is exhausted: steps, rule nesting, source reads or operations. */
    LIMIT,
    /** The execution deadline expired. */
    DEADLINE
  }

  private final int status;
  private final Kind kind;
  private final List<String> issues;
  private final List<Location> locations;

  /** Status {@code 504} creates a {@link Kind#DEADLINE} error; other statuses are INVALID. */
  public ArcException(int status, String message) {
    this(status, message, List.of(message));
  }

  public ArcException(int status, String message, List<String> issues) {
    this(status, status == 504 ? Kind.DEADLINE : Kind.INVALID, message, issues, List.of());
  }

  private ArcException(int status, Kind kind, String message) {
    this(status, kind, message, List.of(message), List.of());
  }

  private ArcException(
      int status, Kind kind, String message, List<String> issues, List<Location> locations) {
    super(message);
    this.status = status;
    this.kind = kind;
    this.issues = issues;
    this.locations = locations;
  }

  public int status() {
    return status;
  }

  public Kind kind() {
    return kind;
  }

  /**
   * Whether a fallback may replace the failed value. Budgets and the deadline belong to the whole
   * execution, so hiding them would make a result depend on how much budget earlier work used.
   */
  public boolean recoverable() {
    return kind == Kind.INVALID || kind == Kind.NOT_AVAILABLE;
  }

  public List<String> issues() {
    return issues;
  }

  public List<Location> locations() {
    return locations;
  }

  public ArcException atNode(String ruleId, Integer version, String nodeId, String label) {
    var next = new ArrayList<>(locations);
    var location = new Location(ruleId, version, nodeId, label);
    if (!next.contains(location)) next.add(location);
    return new ArcException(status, kind, getMessage(), issues, List.copyOf(next));
  }

  public ArcException inRule(String ruleId, Integer version) {
    return new ArcException(
        status,
        kind,
        getMessage(),
        issues,
        locations.stream()
            .map(l -> l.ruleId() == null ? new Location(ruleId, version, l.nodeId(), l.label()) : l)
            .toList());
  }

  /** Adds the owning field/case description without losing a nested rule's locations or kind. */
  public ArcException withContext(String context) {
    return new ArcException(
        status,
        kind,
        context + ": " + getMessage(),
        issues.stream().map(issue -> context + ": " + issue).toList(),
        locations);
  }

  public static ArcException invalid(String message) {
    return new ArcException(422, Kind.INVALID, message);
  }

  public static ArcException notAvailable(String message) {
    return new ArcException(422, Kind.NOT_AVAILABLE, message);
  }

  public static ArcException limit(String message) {
    return new ArcException(422, Kind.LIMIT, message);
  }

  public static ArcException deadline(String message) {
    return new ArcException(504, Kind.DEADLINE, message);
  }
}
