package dev.arc.rule;

import dev.arc.model.*;
import java.util.List;
import java.util.Optional;

/**
 * The rule read model: catalog pages, one rule's summary, version histories, the legacy full list
 * and the rules that call a rule. Nothing here takes a lock or runs in a command's transaction; the
 * locks, the writes and the reads that commands and the resolver need stay on {@link
 * RuleRepository}.
 */
public interface RuleCatalog {
  /**
   * A rule whose saved draft or published versions call another, as their stored callee sets tell
   * before any definition is read: whether its draft and its latest published version call the
   * rule, and how many of its earlier versions do.
   */
  record CallingRule(
      String ruleId,
      String name,
      Integer publishedVersion,
      boolean draftCalls,
      boolean latestCalls,
      int earlierVersions) {}

  /** Every rule with its draft, newest edits first: the unbounded legacy list. */
  List<Rule> list();

  /** Newest edits first; the search matches ID, name and description, and an empty kind all. */
  CatalogPage<RuleSummary> catalog(PageRequest page, String kind, boolean publishedOnly);

  /** Version-descending metadata, filtered by a literal substring of the decimal version. */
  CatalogPage<RuleVersionSummary> versionSummaries(String id, PageRequest page);

  /**
   * One rule's catalog item, without its draft, for clients that need only its current name, kind,
   * publication and creation time; a missing rule is a 404.
   */
  RuleSummary summary(String id);

  /**
   * One page of the other rules whose draft or published versions call the rule, ordered by rule
   * ID, from the callee sets their writes stored ({@link RuleRepository#callersOf} reads the same
   * sets for deletion); a missing rule is a 404. The count and the page are separate statements, as
   * in the catalogs.
   */
  CatalogPage<CallingRule> callingRules(String id, PageRequest page);

  /**
   * The saved draft of rule {@code callerId} ({@code version} null) or one of its published
   * versions, when its stored callee set names rule {@code id}; empty when it does not, or no
   * longer exists.
   */
  Optional<Definition> callingDefinition(String callerId, Integer version, String id);
}
