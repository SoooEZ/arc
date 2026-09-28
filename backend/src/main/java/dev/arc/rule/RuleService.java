package dev.arc.rule;

import dev.arc.engine.DisplayNames;
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

  /** An empty kind lists every kind; the filter and the stored column spell {@link RuleKind}. */
  public CatalogPage<RuleSummary> catalog(PageRequest page, String kind, boolean publishedOnly) {
    if (!kind.isEmpty() && RuleKind.parse(kind).isEmpty())
      throw ArcException.invalid("Unknown rule kind");
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
    String name = DisplayNames.normalize("Rule", request.name());
    description(request.description());
    // The payload keeps the kind as text; an unknown one is a 422 here, never a Jackson 400.
    RuleKind kind =
        RuleKind.parse(request.kind())
            .orElseThrow(() -> ArcException.invalid("Choose " + RuleKind.choices()));
    Definition d =
        withNormalizedNotes(
            request.definition() == null ? RuleSamples.blank(kind) : request.definition());
    validator.shape(d);
    holdCallees(d);
    return store.create(
        request.id(),
        name,
        request.description() == null ? "" : request.description(),
        kind.name(),
        d);
  }

  @Transactional
  public Rule update(String id, Update request) {
    Rule rule = store.lock(id);
    revision(rule, request.revision());
    String name = DisplayNames.normalize("Rule", request.name());
    description(request.description());
    Definition d = withNormalizedNotes(request.definition());
    validator.shape(d);
    holdCallees(d);
    return store.update(id, name, request.description() == null ? "" : request.description(), d);
  }

  @Transactional
  public Rule publish(String id, int revision) {
    Rule rule = store.lock(id);
    revision(rule, revision);
    holdCallees(rule.draft());
    definitions.validate(rule.draft());
    return store.publish(rule);
  }

  /**
   * Deletes the rule with its draft and every published version, so the execution API answers 404
   * for it afterwards. A rule that other rules still call stays, because deleting it would break
   * them. A client that read the rule passes its {@code revision}, so a rule published or replaced
   * since then is kept with a 409, as a stale save would be.
   */
  @Transactional
  public void delete(String id, Integer revision) {
    // A missing rule is a 404. The lock waits for every writer of this rule and of the rules
    // calling it, so the caller scan below sees each committed caller.
    Rule rule = store.lockForDeletion(id);
    if (revision != null) revision(rule, revision);
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

  /**
   * Holds the rules a definition calls until the commit, so deleting one of them either waits for
   * this write or, having committed first, is already gone when the write validates.
   */
  private void holdCallees(Definition definition) {
    Set<String> callees = Validator.calledRuleIds(definition);
    if (!callees.isEmpty()) store.lockCallees(callees);
  }

  /** Each draft ("checkout (draft)") or published version ("checkout v3") that calls the rule. */
  private List<String> callersOf(String id) {
    var callers = new ArrayList<String>();
    for (var stored : store.definitionsMentioning(id)) {
      if (!Validator.calledRuleIds(stored.definition()).contains(id)) continue;
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
          409,
          "This rule changed in another editor. Reload it before saving, publishing or deleting.");
  }

  /**
   * A note is one line without surrounding whitespace, the only form an ARC Script comment can
   * carry, so a draft's notes take that form when they are saved: graph → code → graph then returns
   * the same draft (lesson B12), and a note that would render more comments than the parser accepts
   * fails the shape check here instead of making the code unbuildable. Stored drafts and versions
   * are not rewritten; notes never affect execution.
   */
  private static Definition withNormalizedNotes(Definition definition) {
    if (definition == null || definition.notes() == null) return definition;
    var notes = new ArrayList<String>();
    for (String note : definition.notes()) {
      if (note == null) notes.add(null); // reported by the shape check
      else for (String line : note.split("\\R", -1)) notes.add(line.strip());
    }
    return new Definition(
        definition.schemaVersion(),
        definition.inputs(),
        definition.nodes(),
        definition.edges(),
        notes);
  }

  private static void description(String description) {
    if (description != null && description.length() > Limits.MAX_DESCRIPTION_CHARACTERS)
      throw ArcException.invalid(
          "Description exceeds "
              + Limits.format(Limits.MAX_DESCRIPTION_CHARACTERS)
              + " characters");
  }
}
