package dev.arc.rule;

import dev.arc.engine.Identifiers;
import dev.arc.engine.Limits;
import dev.arc.engine.execution.Engine;
import dev.arc.engine.validation.Validator;
import dev.arc.error.ArcException;
import dev.arc.model.*;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/** Draft commands and immutable publication; transaction boundaries live here. */
@Service
public class RuleService {
  public record Create(
      String id, String name, String description, String kind, Definition definition) {}

  public record Update(String name, String description, int revision, Definition definition) {}

  public record Publish(int revision) {}

  private static final Set<String> KINDS = Set.of("DECISION_TREE", "FORMULA", "RULE");

  /** How many callers a refused deletion names in its message; `issues` lists them all. */
  private static final int NAMED_CALLERS = 5;

  private final RuleRepository store;
  private final Validator validator;
  private final RuleDefinitionService definitions;
  private final Engine engine;

  public RuleService(
      RuleRepository store, Validator validator, RuleDefinitionService definitions, Engine engine) {
    this.store = store;
    this.validator = validator;
    this.definitions = definitions;
    this.engine = engine;
  }

  /** An empty kind lists every kind. */
  public CatalogPage<RuleSummary> catalog(PageRequest page, String kind, boolean publishedOnly) {
    if (!kind.isEmpty() && !KINDS.contains(kind)) throw ArcException.invalid("Unknown rule kind");
    return store.catalog(page, kind, publishedOnly);
  }

  public CatalogPage<RuleVersionSummary> versionSummaries(String id, PageRequest page) {
    return store.versionSummaries(id, page);
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
    if (!Identifiers.isResourceId(request.id()))
      throw ArcException.invalid(
          "Rule ID must start with a lowercase letter and contain only lowercase letters, digits,"
              + " and hyphens (max "
              + Limits.MAX_RESOURCE_ID_CHARACTERS
              + ")");
    metadata(request.name(), request.description());
    if (request.kind() == null || !KINDS.contains(request.kind()))
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

  /**
   * Deletes the rule with its draft and every published version, so the execution API answers 404
   * for it afterwards. A rule that other rules still call stays, because deleting it would break
   * them.
   */
  @Transactional
  public void delete(String id) {
    // A missing rule is a 404; a concurrent save or publish of this rule waits for the deletion.
    store.lock(id);
    List<String> callers = callersOf(id);
    if (!callers.isEmpty())
      throw new ArcException(
          409,
          "Other rules call this rule: "
              + named(callers)
              + ". Remove those calls before deleting it.",
          callers);
    store.delete(id);
    afterCommit(() -> engine.forget(id));
  }

  /** Each draft ("checkout (draft)") or published version ("checkout v3") that calls the rule. */
  private List<String> callersOf(String id) {
    var callers = new ArrayList<String>();
    for (var stored : store.definitionsMentioning(id)) {
      boolean calls =
          Validator.draftDependencies(stored.definition()).stream()
              .anyMatch(dependency -> dependency.ruleId().equals(id));
      if (!calls) continue;
      callers.add(
          stored.version() == null
              ? stored.ruleId() + " (draft)"
              : stored.ruleId() + " v" + stored.version());
    }
    return callers;
  }

  private static String named(List<String> callers) {
    if (callers.size() <= NAMED_CALLERS) return String.join(", ", callers);
    return String.join(", ", callers.subList(0, NAMED_CALLERS))
        + " and "
        + (callers.size() - NAMED_CALLERS)
        + " more";
  }

  /**
   * Runs the action once the current transaction commits, or at once outside one. Until the commit,
   * other requests still read the deleted rule, so its plans are forgotten only afterwards.
   */
  private static void afterCommit(Runnable action) {
    if (!TransactionSynchronizationManager.isSynchronizationActive()) {
      action.run();
      return;
    }
    TransactionSynchronizationManager.registerSynchronization(
        new TransactionSynchronization() {
          @Override
          public void afterCommit() {
            action.run();
          }
        });
  }

  private void revision(Rule rule, int revision) {
    if (rule.revision() != revision)
      throw new ArcException(
          409, "This rule changed in another editor. Reload it before saving or publishing.");
  }

  private void metadata(String name, String description) {
    if (name == null || name.isBlank() || name.length() > Limits.MAX_NAME_CHARACTERS)
      throw ArcException.invalid(
          "Name must contain 1 to " + Limits.MAX_NAME_CHARACTERS + " characters");
    if (description != null && description.length() > Limits.MAX_DESCRIPTION_CHARACTERS)
      throw ArcException.invalid(
          "Description exceeds "
              + Limits.format(Limits.MAX_DESCRIPTION_CHARACTERS)
              + " characters");
  }
}
