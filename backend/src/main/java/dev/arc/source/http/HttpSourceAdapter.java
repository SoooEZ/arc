package dev.arc.source.http;

import dev.arc.error.ArcException;
import dev.arc.model.SourceDefinition;
import dev.arc.source.SourceAdapter;
import java.util.Map;
import org.springframework.stereotype.Component;

/** Adapts bounded HTTP transport to the source extension point. */
@Component
public final class HttpSourceAdapter implements SourceAdapter {
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
    http.validate(definition);
    if (definition.timeoutMs() < 100 || definition.timeoutMs() > 10000)
      throw ArcException.invalid("HTTP timeout must be 100–10,000 ms");
  }

  @Override
  public Object fetch(String id, SourceDefinition definition, Map<String, Object> inputs) {
    return http.fetch(definition, inputs);
  }
}
