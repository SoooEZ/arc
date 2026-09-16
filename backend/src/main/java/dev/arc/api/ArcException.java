package dev.arc.api;

import java.util.List;

public class ArcException extends RuntimeException {
    private final int status;
    private final List<String> issues;
    public ArcException(int status, String message) { this(status, message, List.of(message)); }
    public ArcException(int status, String message, List<String> issues) {
        super(message); this.status = status; this.issues = issues;
    }
    public int status() { return status; }
    public List<String> issues() { return issues; }
    public static ArcException invalid(String message) { return new ArcException(422, message); }
}
