package dev.arc.rule;

import dev.arc.engine.validation.RuleCalls;
import dev.arc.error.ArcException;
import dev.arc.model.*;
import java.util.ArrayList;
import java.util.List;
import org.springframework.stereotype.Service;

/**
 * Reads of the rule catalog: pages of summaries, one rule's summary, version histories, the legacy
 * full list, and the rules that call a rule with the versions they pin. Nothing here locks or
 * writes; the commands live in {@link RuleService}.
 */
@Service
public class RuleCatalogService {
  private final RuleCatalog catalog;

  public RuleCatalogService(RuleCatalog catalog) {
    this.catalog = catalog;
  }

  /** An empty kind lists every kind; the filter and the stored column spell {@link RuleKind}. */
  public CatalogPage<RuleSummary> catalog(PageRequest page, String kind, boolean publishedOnly) {
    if (!kind.isEmpty() && RuleKind.parse(kind).isEmpty())
      throw ArcException.invalid("Unknown rule kind");
    return catalog.catalog(page, kind, publishedOnly);
  }

  public CatalogPage<RuleVersionSummary> versionSummaries(String id, PageRequest page) {
    return catalog.versionSummaries(id, page);
  }

  public RuleSummary summary(String id) {
    return catalog.summary(id);
  }

  public List<Rule> list() {
    return catalog.list();
  }

  /**
   * One page of the other rules that call the rule, by rule ID, with the versions of it that their
   * saved drafts and latest published versions pin. Each definition is read on its own, so a page
   * holds one at a time however large its callers' drafts are. A caller that changes between the
   * reads shows what the later read found: a draft that stopped calling the rule has no pins.
   */
  public CatalogPage<RuleCaller> callers(String id, PageRequest page) {
    CatalogPage<RuleCatalog.CallingRule> calling = catalog.callingRules(id, page);
    var callers = new ArrayList<RuleCaller>();
    for (var rule : calling.items()) callers.add(caller(rule, id));
    return new CatalogPage<>(callers, calling.total(), calling.offset(), calling.limit());
  }

  private RuleCaller caller(RuleCatalog.CallingRule rule, String id) {
    List<Integer> draftPins = rule.draftCalls() ? pins(rule.ruleId(), null, id) : null;
    RuleCaller.Published published = null;
    if (rule.latestCalls()) {
      List<Integer> pins = pins(rule.ruleId(), rule.publishedVersion(), id);
      if (pins != null) published = new RuleCaller.Published(rule.publishedVersion(), pins);
    }
    return new RuleCaller(rule.ruleId(), rule.name(), draftPins, published, rule.earlierVersions());
  }

  /**
   * The versions of rule {@code id} that the caller's saved draft ({@code version} null) or
   * published version pins; null when it no longer calls the rule.
   */
  private List<Integer> pins(String callerId, Integer version, String id) {
    var definition = catalog.callingDefinition(callerId, version, id);
    return definition.isEmpty()
        ? null
        : List.copyOf(RuleCalls.pinnedVersions(definition.get(), id));
  }
}
