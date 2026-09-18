package dev.arc.error;

import java.util.*;

public class ArcException extends RuntimeException {
  public record Location(String ruleId, Integer version, String nodeId, String label) {}

  private final int status;
  private final List<String> issues;
  private final List<Location> locations;

  public ArcException(int status, String message) {
    this(status, message, List.of(message));
  }

  public ArcException(int status, String message, List<String> issues) {
    this(status, message, issues, List.of());
  }

  private ArcException(int status, String message, List<String> issues, List<Location> locations) {
    super(message);
    this.status = status;
    this.issues = issues;
    this.locations = locations;
  }

  public int status() {
    return status;
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
    return new ArcException(status, getMessage(), issues, List.copyOf(next));
  }

  public ArcException inRule(String ruleId, Integer version) {
    return new ArcException(
        status,
        getMessage(),
        issues,
        locations.stream()
            .map(l -> l.ruleId() == null ? new Location(ruleId, version, l.nodeId(), l.label()) : l)
            .toList());
  }

  public static ArcException invalid(String message) {
    return new ArcException(422, message);
  }
}
