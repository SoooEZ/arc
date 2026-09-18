package dev.arc.source;

import dev.arc.engine.SourceReader;
import dev.arc.engine.Validator;
import dev.arc.error.ArcException;
import dev.arc.model.*;
import dev.arc.model.Definition.*;
import java.util.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class SourceService implements SourceReader {
  public record Create(String id, String name, SourceDefinition definition) {}

  public record Update(String name, int revision, SourceDefinition definition) {}

  public record Test(Map<String, Object> inputs, Integer version) {}

  private final SourceRepository repository;
  private final SourceValidator validator;
  private final SourceAdapters adapters;
  private final JsonPointerExtractor extractor;

  public SourceService(
      SourceRepository repository,
      SourceValidator validator,
      SourceAdapters adapters,
      JsonPointerExtractor extractor) {
    this.repository = repository;
    this.validator = validator;
    this.adapters = adapters;
    this.extractor = extractor;
  }

  public List<DataSource> list() {
    return repository.list();
  }

  public DataSource get(String id, int version) {
    return repository.get(id, version);
  }

  public List<DataSource> versions(String id) {
    return repository.versions(id);
  }

  @Transactional
  public DataSource create(Create request) {
    if (request.id() == null || !request.id().matches("[a-z][a-z0-9-]{0,79}"))
      throw ArcException.invalid("Invalid source ID");
    validator.validate(request.name(), request.definition());
    return repository.create(request.id(), request.name(), request.definition());
  }

  @Transactional
  public DataSource update(String id, Update request) {
    validator.validate(request.name(), request.definition());
    return repository.update(id, request.name(), request.revision(), request.definition());
  }

  public Object test(String id, Test request) {
    Integer version = request.version();
    if (version == null) {
      var all = versions(id);
      if (all.isEmpty()) throw new ArcException(404, "Source not found");
      version = all.getFirst().version();
    }
    return fetch(id, version, request.inputs());
  }

  @Override
  public Object read(SourceBinding binding, Map<String, Object> inputs) {
    return extractor.extract(fetch(binding.id(), binding.version(), inputs), binding.pointer());
  }

  public Object fetch(String id, int version, Map<String, Object> inputs) {
    var c = get(id, version).definition();
    var values = new LinkedHashMap<String, Object>();
    if (inputs == null) throw ArcException.invalid("Source inputs must be an object");
    for (String key : inputs.keySet())
      if (c.parameters().stream().noneMatch(p -> p.name().equals(key)))
        throw ArcException.invalid("Unknown source parameter: " + key);
    for (Input p : c.parameters()) {
      Object v = inputs.containsKey(p.name()) ? inputs.get(p.name()) : p.defaultValue();
      if (v == null && p.required())
        throw ArcException.invalid("Missing source parameter: " + p.name());
      values.put(p.name(), v == null ? null : Validator.checkType(p.name(), p.type(), v));
    }
    return adapters.require(c.kind()).fetch(id, c, values);
  }
}
