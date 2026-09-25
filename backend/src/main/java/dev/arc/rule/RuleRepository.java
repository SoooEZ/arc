package dev.arc.rule;

import dev.arc.engine.RuleResolver;
import dev.arc.model.*;
import java.util.List;

/** Storage port. lock/update/publish are called inside the application transaction. */
public interface RuleRepository extends RuleResolver {
  List<Rule> list();

  CatalogPage<RuleSummary> catalog(
      int offset, int limit, String search, String kind, boolean publishedOnly);

  CatalogPage<RuleVersionSummary> versionSummaries(String id, int offset, int limit);

  Rule get(String id);

  /** Read only the current publication pointer; missing rules return 404. */
  Integer publishedVersion(String id);

  Rule lock(String id);

  Rule create(String id, String name, String description, String kind, Definition definition);

  Rule update(String id, String name, String description, Definition definition);

  Rule publish(Rule rule);

  List<RuleVersion> versions(String id);

  RuleVersion version(String id, int version);

  @Override
  default Definition resolve(String id, int version) {
    return version(id, version).definition();
  }
}
