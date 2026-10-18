package dev.arc.api;

import dev.arc.model.*;
import dev.arc.rule.RuleCatalogService;
import dev.arc.rule.RuleExecutionService;
import dev.arc.rule.RuleExecutionService.*;
import dev.arc.rule.RuleService;
import dev.arc.rule.RuleService.*;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api")
public class RuleController {
  private final RuleService rules;
  private final RuleCatalogService catalog;
  private final RuleExecutionService execution;

  public RuleController(
      RuleService rules, RuleCatalogService catalog, RuleExecutionService execution) {
    this.rules = rules;
    this.catalog = catalog;
    this.execution = execution;
  }

  @GetMapping("/rules")
  public List<Rule> list() {
    return catalog.list();
  }

  @GetMapping("/rule-summaries")
  public CatalogPage<RuleSummary> catalog(
      @RequestParam(required = false) Integer offset,
      @RequestParam(required = false) Integer limit,
      @RequestParam(required = false) String search,
      @RequestParam(defaultValue = "") String kind,
      @RequestParam(defaultValue = "false") boolean publishedOnly) {
    return catalog.catalog(PageParameters.page(offset, limit, search), kind, publishedOnly);
  }

  @GetMapping("/rule-summaries/{id}")
  public RuleSummary summary(@PathVariable String id) {
    return catalog.summary(id);
  }

  @GetMapping("/rules/{id}/version-summaries")
  public CatalogPage<RuleVersionSummary> versionSummaries(
      @PathVariable String id,
      @RequestParam(required = false) Integer offset,
      @RequestParam(required = false) Integer limit,
      @RequestParam(required = false) String search) {
    return catalog.versionSummaries(id, PageParameters.page(offset, limit, search));
  }

  @GetMapping("/rules/{id}/callers")
  public CatalogPage<RuleCaller> callers(
      @PathVariable String id,
      @RequestParam(required = false) Integer offset,
      @RequestParam(required = false) Integer limit) {
    return catalog.callers(id, PageParameters.page(offset, limit, null));
  }

  @PostMapping("/rules")
  @ResponseStatus(HttpStatus.CREATED)
  public Rule create(@RequestBody Create request) {
    return rules.create(request);
  }

  @PostMapping("/rules/{id}/duplicate")
  @ResponseStatus(HttpStatus.CREATED)
  public Rule duplicate(@PathVariable String id, @RequestBody Duplicate request) {
    return rules.duplicate(id, request);
  }

  @GetMapping("/rules/{id}")
  public Rule get(@PathVariable String id) {
    return rules.get(id);
  }

  @PutMapping("/rules/{id}")
  public Rule update(@PathVariable String id, @RequestBody Update request) {
    return rules.update(id, request);
  }

  @DeleteMapping("/rules/{id}")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  public void delete(@PathVariable String id, @RequestParam(required = false) Integer revision) {
    rules.delete(id, revision);
  }

  @PostMapping("/rules/{id}/publish")
  public Rule publish(@PathVariable String id, @RequestBody Publish request) {
    return rules.publish(id, request.revision(), request.note());
  }

  @GetMapping("/rules/{id}/versions")
  public List<RuleVersion> versions(@PathVariable String id) {
    return rules.versions(id);
  }

  @GetMapping("/rules/{id}/versions/{version}")
  public RuleVersion version(@PathVariable String id, @PathVariable int version) {
    return rules.version(id, version);
  }

  @PostMapping("/rules/{id}/execute")
  public ExecutionResponse execute(@PathVariable String id, @RequestBody Execution request) {
    return execution.execute(id, request);
  }

  @PostMapping("/preview")
  public ExecutionResponse preview(@RequestBody Preview request) {
    return execution.preview(request);
  }
}
