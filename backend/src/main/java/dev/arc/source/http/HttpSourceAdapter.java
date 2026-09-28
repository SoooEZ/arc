package dev.arc.source.http;

import dev.arc.engine.ExecutionDeadline;
import dev.arc.engine.Limits;
import dev.arc.error.ArcException;
import dev.arc.model.SourceDefinition;
import dev.arc.source.SourceAdapter;
import java.util.Map;
import org.springframework.stereotype.Component;

/** Adapts bounded HTTP transport to the source extension point. */
@Component
public final class HttpSourceAdapter implements SourceAdapter {
  private static final int MIN_TIMEOUT_MS = 100;
  private static final int MAX_TIMEOUT_MS = 10_000;

  private final HttpSource http;

  public HttpSourceAdapter(HttpSource http) {
    this.http = http;
  }

  @Override
  public String kind() {
    return "HTTP";
  }

  @Override
  public void validate(SourceDefinition definition) {
    // A provider rejects configuration it does not use: unbounded entries were stored as is and
    // made the read-back of the new version fail with a 500.
    if (definition.entries() != null && !definition.entries().isEmpty())
      throw ArcException.invalid("HTTP sources do not use lookup entries");
    http.validate(definition);
    if (definition.timeoutMs() < MIN_TIMEOUT_MS || definition.timeoutMs() > MAX_TIMEOUT_MS)
      throw ArcException.invalid(
          "HTTP timeout must be " + MIN_TIMEOUT_MS + "–" + Limits.format(MAX_TIMEOUT_MS) + " ms");
  }

  @Override
  public Object fetch(
      String id,
      SourceDefinition definition,
      Map<String, Object> inputs,
      ExecutionDeadline deadline) {
    return http.fetch(definition, inputs, deadline);
  }
}
