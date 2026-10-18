package dev.arc.rule;

import dev.arc.engine.DisplayNames;
import dev.arc.engine.Identifiers;
import dev.arc.engine.Limits;
import dev.arc.engine.execution.Engine;
import dev.arc.engine.script.ArcScript;
import dev.arc.engine.validation.RuleCalls;
import dev.arc.engine.validation.Validator;
import dev.arc.error.ArcException;
import dev.arc.error.Revisions;
import dev.arc.model.*;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/**
 * The rule's commands: create, save, duplicate, publish and delete, and the reads of a rule and its
 * versions that clients make before them. Transaction boundaries and lock order live here; lists,
 * summaries and callers are read by {@link RuleCatalogService}.
 */
@Service
public class RuleService {
  public record Create(
      String id, String name, String description, String kind, Definition definition) {}

  /** A save names the revision its client read; without one it is refused, never taken as 0. */
  public record Update(String name, String description, Integer revision, Definition definition) {}

  /** A publication names the revision its client reviewed, and may say what the version changes. */
  public record Publish(Integer revision, String note) {}

  /**
   * A copy of a rule as a new one. An omitted or null {@code description} copies the original's;
   * {@code version} copies that published version instead of the saved draft; the saved test cases
   * are copied unless {@code includeTests} is false.
   */
  public record Duplicate(
      String id, String name, String description, Integer version, Boolean includeTests) {}

  /** How many callers a refused deletion names in its message; `issues` lists them all. */
  private static final int NAMED_CALLERS = 5;

  private final RuleRepository store;
  private final RuleTestCaseRepository testCases;
  private final Validator validator;
  private final RuleDefinitionService definitions;
  private final Engine engine;

  public RuleService(
      RuleRepository store,
      RuleTestCaseRepository testCases,
      Validator validator,
      RuleDefinitionService definitions,
      Engine engine) {
    this.store = store;
    this.testCases = testCases;
    this.validator = validator;
    this.definitions = definitions;
    this.engine = engine;
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
    requireRuleId(request.id());
    Metadata metadata = metadata(request.name(), request.description());
    // The payload keeps the kind as text; an unknown one is a 422 here, never a Jackson 400.
    RuleKind kind =
        RuleKind.parse(request.kind())
            .orElseThrow(() -> ArcException.invalid("Choose " + RuleKind.choices()));
    StorableDraft draft =
        storableDraft(
            request.definition() == null ? RuleTemplates.blank(kind) : request.definition());
    return store.create(
        request.id(),
        metadata.name(),
        metadata.description(),
        kind.name(),
        draft.definition(),
        draft.callees());
  }

  /**
   * Creates rule {@code request.id()} with the original's kind and its saved draft, or published
   * {@code version}, as the new draft, and copies the original's saved test cases unless asked not
   * to; nothing is published. The original is a 404 before the request is checked, as for every
   * write, and is held against deletion until the copy commits, so the draft, the version and the
   * cases all come from one rule. The new rule is checked and stored exactly as a create stores it.
   */
  @Transactional
  public Rule duplicate(String originalId, Duplicate request) {
    Rule original = store.lockForCopy(originalId);
    requireRuleId(request.id());
    String description =
        request.description() == null ? original.description() : request.description();
    Metadata metadata = metadata(request.name(), description);
    Definition copied =
        request.version() == null
            ? original.draft()
            : store.version(originalId, request.version()).definition();
    StorableDraft draft = storableDraft(copied);
    Rule created =
        store.create(
            request.id(),
            metadata.name(),
            metadata.description(),
            original.kind(),
            draft.definition(),
            draft.callees());
    if (!Boolean.FALSE.equals(request.includeTests()))
      testCases.copyCases(originalId, created.id());
    return created;
  }

  /** IDs follow the shared resource ID policy ({@link Identifiers#isResourceId}). */
  private static void requireRuleId(String id) {
    if (!Identifiers.isResourceId(id))
      throw ArcException.invalid(
          "Rule ID must start with a lowercase letter and contain only lowercase letters, digits,"
              + " and hyphens (max "
              + Limits.MAX_RESOURCE_ID_CHARACTERS
              + ")");
  }

  @Transactional
  public Rule update(String id, Update request) {
    requireRevision(store.lockForSave(id), request.revision());
    Metadata metadata = metadata(request.name(), request.description());
    StorableDraft draft = storableDraft(request.definition());
    return store.update(
        id, metadata.name(), metadata.description(), draft.definition(), draft.callees());
  }

  /** The name and description a create or a save stores. */
  private record Metadata(String name, String description) {}

  /** The trimmed name and the description, empty when missing, within their limits. */
  private static Metadata metadata(String name, String description) {
    String trimmed = DisplayNames.normalize("Rule", name);
    Limits.requireAtMost("Description", description, Limits.MAX_DESCRIPTION_CHARACTERS);
    return new Metadata(trimmed, description == null ? "" : description);
  }

  /** A draft ready to store, with the rules it calls, which the write stores beside it. */
  private record StorableDraft(Definition definition, Set<String> callees) {}

  /**
   * The draft a create or a save stores: its notes in comment form and its shape checked, with the
   * rules it calls held against deletion until the commit.
   */
  private StorableDraft storableDraft(Definition definition) {
    Definition draft = withNormalizedNotes(definition);
    validator.shape(draft);
    return new StorableDraft(draft, holdCallees(draft));
  }

  @Transactional
  public Rule publish(String id, Integer revision, String note) {
    Rule rule = store.lockForPublication(id);
    String kept = releaseNote(note);
    requireRevision(rule.revision(), revision);
    Set<String> callees = holdCallees(rule.draft());
    definitions.validateForPublication(rule.draft());
    return store.publish(rule, callees, kept);
  }

  /** A version's note as stored: as written, none when blank, within its limit. */
  private static String releaseNote(String note) {
    if (note == null || note.isBlank()) return null;
    Limits.requireAtMost("Release note", note, Limits.MAX_RELEASE_NOTE_CHARACTERS);
    return note;
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
    int current = store.lockForDeletion(id);
    if (revision != null) requireRevision(current, revision);
    List<String> callers = callersOf(id);
    if (!callers.isEmpty())
      throw ArcException.conflict(
          "Other rules call this rule: "
              + named(callers)
              + ". Remove those calls before deleting it.",
          callers);
    store.delete(id);
    afterCommit(() -> engine.forget(id));
  }

  /**
   * Holds the rules a definition calls until the commit, so deleting one of them either waits for
   * this write or, having committed first, is already gone when the write validates. The same set
   * is what the write stores beside the definition, for later deletions to find their callers.
   */
  private Set<String> holdCallees(Definition definition) {
    Set<String> callees = RuleCalls.calledRuleIds(definition);
    if (!callees.isEmpty()) store.lockCallees(callees);
    return callees;
  }

  /** Each draft ("checkout (draft)") or published version ("checkout v3") that calls the rule. */
  private List<String> callersOf(String id) {
    var callers = new ArrayList<String>();
    for (var caller : store.callersOf(id)) callers.add(caller.describe());
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

  /**
   * The shared revision policy ({@link Revisions#require}) with a rule's stale message. A deletion
   * leaves the check out when it names no revision.
   */
  private static void requireRevision(int current, Integer read) {
    Revisions.require(
        current,
        read,
        "This rule changed in another editor. Reload it before saving, publishing or deleting.");
  }

  /**
   * A draft's notes take the one form an ARC Script comment can carry ({@link ArcScript#noteLines})
   * when they are saved: graph → code → graph then returns the same draft (lesson B12), and a note
   * that would render more comments than the parser accepts fails the shape check here instead of
   * making the code unbuildable. Stored drafts and versions are not rewritten; notes never affect
   * execution.
   */
  private static Definition withNormalizedNotes(Definition definition) {
    if (definition == null || definition.notes() == null) return definition;
    var notes = new ArrayList<String>();
    for (String note : definition.notes()) {
      if (note == null) notes.add(null); // reported by the shape check
      else notes.addAll(ArcScript.noteLines(note));
    }
    return new Definition(
        definition.schemaVersion(),
        definition.inputs(),
        definition.nodes(),
        definition.edges(),
        notes);
  }
}
