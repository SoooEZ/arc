package dev.arc.rule;

import dev.arc.engine.validation.Validator;
import dev.arc.error.ArcException;
import dev.arc.model.*;
import java.util.List;
import java.util.Set;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Draft commands and immutable publication; transaction boundaries live here. */
@Service
public class RuleService {
  public record Create(
      String id, String name, String description, String kind, Definition definition) {}

  public record Update(String name, String description, int revision, Definition definition) {}

  public record Publish(int revision) {}

  private final RuleRepository store;
  private final Validator validator;
  private final RuleDefinitionService definitions;

  public RuleService(RuleRepository store, Validator validator, RuleDefinitionService definitions) {
    this.store = store;
    this.validator = validator;
    this.definitions = definitions;
  }

  public CatalogPage<RuleSummary> catalog(
      int offset, int limit, String search, String kind, boolean publishedOnly) {
    pageBounds(offset, limit);
    if (search.length() > 200) throw ArcException.invalid("Search is limited to 200 characters");
    if (!Set.of("", "DECISION_TREE", "FORMULA", "RULE").contains(kind))
      throw ArcException.invalid("Unknown rule kind");
    return store.catalog(offset, limit, search, kind, publishedOnly);
  }

  public CatalogPage<RuleVersionSummary> versionSummaries(String id, int offset, int limit) {
    pageBounds(offset, limit);
    return store.versionSummaries(id, offset, limit);
  }

  private void pageBounds(int offset, int limit) {
    if (offset < 0 || limit < 1 || limit > 100)
      throw ArcException.invalid("Use offset >= 0 and limit from 1 to 100");
  }

  public List<Rule> list() {
    return store.list();
  }

  public Rule get(String id) {
    return store.get(id);
  }

  public List<RuleVersion> versions(String id) {
    return store.versions(id);
  }

  public RuleVersion version(String id, int version) {
    return store.version(id, version);
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
        request.definition() == null ? RuleSamples.blank(request.kind()) : request.definition();
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
    definitions.validate(rule.draft());
    return store.publish(rule);
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
