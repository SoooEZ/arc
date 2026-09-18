package dev.arc.source;

import dev.arc.error.ArcException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Component;

@Component
public final class SourceAdapters {
  private final Map<String, SourceAdapter> adapters;

  public SourceAdapters(List<SourceAdapter> adapters) {
    var registered = new LinkedHashMap<String, SourceAdapter>();
    for (var adapter : adapters)
      if (registered.putIfAbsent(adapter.kind(), adapter) != null)
        throw new IllegalArgumentException("Duplicate source adapter: " + adapter.kind());
    this.adapters = Map.copyOf(registered);
  }

  public SourceAdapter require(String kind) {
    var adapter = kind == null ? null : adapters.get(kind);
    if (adapter == null)
      throw ArcException.invalid(
          "Source kind must be "
              + String.join(" or ", adapters.keySet().stream().sorted().toList()));
    return adapter;
  }
}
