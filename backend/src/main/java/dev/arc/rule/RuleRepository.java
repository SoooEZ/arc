package dev.arc.rule;

import dev.arc.engine.RuleResolver;
import dev.arc.model.*;
import java.util.Collection;
import java.util.List;

/** Storage port. lock/update/publish/delete are called inside the application transaction. */
public interface RuleRepository extends RuleResolver {
  /** A rule's draft ({@code version} null) or one of its published versions. */
  record StoredDefinition(String ruleId, Integer version, Definition definition) {}

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

  Rule get(String id);

  /** Read only the current publication pointer; missing rules return 404. */
  Integer publishedVersion(String id);

  /**
   * Locks a rule for a save or publication. The lock excludes other writers of the rule but not the
   * rules that call it, which only hold it against deletion ({@link #lockCallees}).
   */
  Rule lock(String id);

  /** Locks a rule for deletion, which waits for every writer of a rule that calls it. */
  Rule lockForDeletion(String id);

  /**
   * Holds the rules a definition calls against deletion until the transaction ends, so a caller
   * saved or published now is either seen by a later deletion or refused by an earlier one. IDs
   * that name no rule are ignored.
   */
  void lockCallees(Collection<String> ruleIds);

  /** An ID that is already stored, including by a concurrent create, is a 409 conflict. */
  Rule create(String id, String name, String description, String kind, Definition definition);

  Rule update(String id, String name, String description, Definition definition);

  Rule publish(Rule rule);

  /** Newest first; missing rules return 404. */
  List<RuleVersion> versions(String id);

  RuleVersion version(String id, int version);

  /**
   * The drafts and published versions of other rules that may call the rule: every definition with
   * a Reference pin to the ID or a Formula call {@code @id:version}, and possibly more, for the
   * caller to check exactly.
   */
  List<StoredDefinition> definitionsMentioning(String id);

  /** Removes the rule with its draft and every published version. */
  void delete(String id);

  @Override
  default Definition resolve(String id, int version) {
    return version(id, version).definition();
  }
}
