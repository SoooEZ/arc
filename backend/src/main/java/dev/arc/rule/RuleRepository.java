package dev.arc.rule;

import dev.arc.engine.RuleResolver;
import dev.arc.error.ArcException;
import dev.arc.model.*;
import java.util.Collection;
import java.util.List;
import java.util.Set;

/** Storage port. lock/update/publish/delete are called inside the application transaction. */
public interface RuleRepository extends RuleResolver {
  /** A rule that calls another: its draft ({@code version} null) or one of its versions. */
  record Caller(String ruleId, Integer version) {
    /** "checkout (draft)" or "checkout v3", as a refused deletion names it. */
    public String describe() {
      return version == null ? ruleId + " (draft)" : ruleId + " v" + version;
    }
  }

  /** A published version read together with the {@link RuleKind} name of its rule. */
  record KindedVersion(String kind, Definition definition) {}

  List<Rule> list();

  /**
   * Claims the one-time seeding of the sample rules: true for the first caller in the workspace's
   * life, false afterwards, however many rules the workspace holds now.
   */
  boolean claimSampleSeeding();

  /** Newest edits first; the search matches ID, name and description, and an empty kind all. */
  CatalogPage<RuleSummary> catalog(PageRequest page, String kind, boolean publishedOnly);

  /** Version-descending metadata, filtered by a literal substring of the decimal version. */
  CatalogPage<RuleVersionSummary> versionSummaries(String id, PageRequest page);

  /**
   * One rule's catalog item, without its draft, for clients that need only its current name, kind,
   * publication and creation time; a missing rule is a 404.
   */
  RuleSummary summary(String id);

  Rule get(String id);

  /** Read only the current publication pointer; missing rules return 404. */
  Integer publishedVersion(String id);

  /**
   * Locks a rule for a save and returns its revision without reading its draft. The lock excludes
   * other writers of the rule but not the rules that call it, which only hold it against deletion
   * ({@link #lockCallees}).
   */
  int lockForSave(String id);

  /** Locks a rule for a publication, as {@link #lockForSave} does, and reads the draft it needs. */
  Rule lockForPublication(String id);

  /**
   * Locks a rule for deletion and returns its revision; the lock waits for every writer of a rule
   * that calls it.
   */
  int lockForDeletion(String id);

  /**
   * Holds the rules a definition calls against deletion until the transaction ends, so a caller
   * saved or published now is either seen by a later deletion or refused by an earlier one. IDs
   * that name no rule are ignored.
   */
  void lockCallees(Collection<String> ruleIds);

  /**
   * An ID that is already stored, including by a concurrent create, is a 409 conflict. Each write
   * returns the rule as stored, read by the write itself, and stores {@code callees}, the rules the
   * definition calls ({@code Validator.calledRuleIds}), beside it for {@link #callersOf}.
   */
  Rule create(
      String id,
      String name,
      String description,
      String kind,
      Definition definition,
      Set<String> callees);

  Rule update(
      String id, String name, String description, Definition definition, Set<String> callees);

  /**
   * Stores the locked rule's draft as its next version, with {@code callees} as the version's and
   * the draft's callee set and {@code note} (null for none) as the version's note, and returns the
   * rule with the draft as read under the lock.
   */
  Rule publish(Rule rule, Set<String> callees, String note);

  /** Newest first; missing rules return 404. */
  List<RuleVersion> versions(String id);

  RuleVersion version(String id, int version);

  /**
   * A published version with its rule's kind, read in one statement for {@link #resolveFormula}; a
   * missing version is a 404 "Published Formula version not found: id vN".
   */
  KindedVersion versionWithKind(String id, int version);

  /**
   * The drafts and published versions of other rules that call the rule, by rule ID and then
   * version with the draft first, from the callee sets their writes stored.
   */
  List<Caller> callersOf(String id);

  /** Removes the rule with its draft and every published version. */
  void delete(String id);

  @Override
  default Definition resolve(String id, int version) {
    return version(id, version).definition();
  }

  /**
   * Only a published Formula may be called with {@code @id:version}. The policy reads the kind that
   * storage returns and is decided here, in the rule layer, not inside a row mapper.
   */
  @Override
  default Definition resolveFormula(String id, int version) {
    KindedVersion stored = versionWithKind(id, version);
    if (RuleKind.parse(stored.kind()).filter(RuleKind::callableByFormula).isEmpty())
      throw ArcException.invalid("@ calls require a published Formula: " + id);
    return stored.definition();
  }
}
