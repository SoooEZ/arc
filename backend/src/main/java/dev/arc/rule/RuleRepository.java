package dev.arc.rule;

import dev.arc.engine.RuleResolver;
import dev.arc.model.*;
import java.util.List;

/** Storage port. lock/update/publish are called inside the application transaction. */
public interface RuleRepository extends RuleResolver {
  List<Rule> list();

  /** Whether any rule is stored, without reading rule rows. */
  boolean hasRules();

  /** Newest edits first; the search matches ID, name and description, and an empty kind all. */
  CatalogPage<RuleSummary> catalog(PageRequest page, String kind, boolean publishedOnly);

  /** Version-descending metadata, filtered by a literal substring of the decimal version. */
  CatalogPage<RuleVersionSummary> versionSummaries(String id, PageRequest page);

  Rule get(String id);

  /** Read only the current publication pointer; missing rules return 404. */
  Integer publishedVersion(String id);

  Rule lock(String id);

  /** An ID that is already stored, including by a concurrent create, is a 409 conflict. */
  Rule create(String id, String name, String description, String kind, Definition definition);

  Rule update(String id, String name, String description, Definition definition);

  Rule publish(Rule rule);

  /** Newest first; missing rules return 404. */
  List<RuleVersion> versions(String id);

  RuleVersion version(String id, int version);

  @Override
  default Definition resolve(String id, int version) {
    return version(id, version).definition();
  }
}
