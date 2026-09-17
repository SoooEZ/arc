package dev.arc.store;

import dev.arc.api.ArcException;
import dev.arc.engine.*;
import dev.arc.model.Definition;
import dev.arc.source.*;
import dev.arc.store.RuleStore.Rule;
import java.util.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class RuleService {
  public record Create(
      String id, String name, String description, String kind, Definition definition) {}

  public record Update(String name, String description, int revision, Definition definition) {}

  public record Publish(int revision) {}

  public record Execution(Map<String, Object> inputs, Integer version) {}

  public record Preview(Definition definition, Map<String, Object> inputs) {}

  public record ExecutionResponse(
      String ruleId,
      Integer version,
      Object result,
      List<Engine.Step> trace,
      long durationMicros,
      List<Parameters.Read> sources) {}

  private final RuleStore store;
  private final Validator validator;
  private final Engine engine;
  private final SourceService sources;

  public RuleService(RuleStore store, Validator validator, Engine engine, SourceService sources) {
    this.store = store;
    this.validator = validator;
    this.engine = engine;
    this.sources = sources;
  }

  @Transactional
  public Rule create(Create request) {
    if (request.id() == null || !request.id().matches("[a-z][a-z0-9-]{0,79}"))
      throw ArcException.invalid(
          "Rule ID must start with a lowercase letter and contain only lowercase letters, digits,"
              + " and hyphens (max 80)");
    metadata(request.name(), request.description());
    if (!Set.of("DECISION_TREE", "FORMULA", "RULE")
        .contains(request.kind() == null ? "" : request.kind()))
      throw ArcException.invalid("Choose DECISION_TREE, FORMULA, or RULE");
    Definition d =
        request.definition() == null ? Samples.blank(request.kind()) : request.definition();
    validator.shape(d);
    return store.create(
        request.id(),
        request.name().trim(),
        request.description() == null ? "" : request.description(),
        request.kind(),
        d);
  }

  @Transactional
  public Rule update(String id, Update request) {
    Rule rule = store.lock(id);
    revision(rule, request.revision());
    metadata(request.name(), request.description());
    validator.shape(request.definition());
    return store.update(
        id,
        request.name().trim(),
        request.description() == null ? "" : request.description(),
        request.definition());
  }

  @Transactional
  public Rule publish(String id, int revision) {
    Rule rule = store.lock(id);
    revision(rule, revision);
    validate(rule.draft());
    return store.publish(rule);
  }

  public ExecutionResponse execute(String id, Execution request) {
    Rule rule = store.get(id);
    Integer version = request.version() == null ? rule.publishedVersion() : request.version();
    if (version == null)
      throw new ArcException(409, "Publish this rule before calling its execution endpoint");
    var definition = store.resolve(id, version);
    validate(definition);
    var result =
        engine.execute(
            id, version, definition, request.inputs(), memoizedResolver(), new Parameters(sources));
    return new ExecutionResponse(
        id, version, result.result(), result.trace(), result.durationMicros(), result.sources());
  }

  public ExecutionResponse preview(Preview request) {
    validate(request.definition());
    var result =
        engine.execute(
            "preview",
            null,
            request.definition(),
            request.inputs(),
            memoizedResolver(),
            new Parameters(sources));
    return new ExecutionResponse(
        "preview",
        null,
        result.result(),
        result.trace(),
        result.durationMicros(),
        result.sources());
  }

  public void validate(Definition definition) {
    validator.validate(definition, memoizedResolver());
    sources.validateBindings(definition, memoizedResolver(), new HashSet<>(), 0);
  }

  public List<Validator.Problem> diagnostics(Definition definition) {
    var resolver = memoizedResolver();
    var problems = validator.diagnostics(definition, resolver);
    // Check stored source contracts only. Diagnostics never perform HTTP requests.
    try {
      validator.shape(definition);
      if (definition.nodes().stream().filter(n -> n.type().equals("INPUT")).count() == 1)
        sources.validateBindings(definition, resolver, new HashSet<>(), 0);
    } catch (ArcException e) {
      if (!e.locations().isEmpty()) {
        var problem = Validator.Problem.from(e);
        if (!problems.contains(problem)) problems.add(problem);
      }
    }
    return problems;
  }

  private RuleResolver memoizedResolver() {
    Map<String, Definition> cache = new HashMap<>();
    return (id, version) ->
        cache.computeIfAbsent(id + "@" + version, key -> store.resolve(id, version));
  }

  private void revision(Rule rule, int revision) {
    if (rule.revision() != revision)
      throw new ArcException(
          409, "This rule changed in another editor. Reload it before saving or publishing.");
  }

  private void metadata(String name, String description) {
    if (name == null || name.isBlank() || name.length() > 160)
      throw ArcException.invalid("Name must contain 1 to 160 characters");
    if (description != null && description.length() > 2000)
      throw ArcException.invalid("Description exceeds 2,000 characters");
  }
}
