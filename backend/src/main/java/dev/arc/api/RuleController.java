package dev.arc.api;

import dev.arc.model.*;
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
  private final RuleExecutionService execution;

  public RuleController(RuleService rules, RuleExecutionService execution) {
    this.rules = rules;
    this.execution = execution;
  }

  @GetMapping("/rules")
  public List<Rule> list() {
    return rules.list();
  }

  @PostMapping("/rules")
  @ResponseStatus(HttpStatus.CREATED)
  public Rule create(@RequestBody Create request) {
    return rules.create(request);
  }

  @GetMapping("/rules/{id}")
  public Rule get(@PathVariable String id) {
    return rules.get(id);
  }

  @PutMapping("/rules/{id}")
  public Rule update(@PathVariable String id, @RequestBody Update request) {
    return rules.update(id, request);
  }

  @PostMapping("/rules/{id}/publish")
  public Rule publish(@PathVariable String id, @RequestBody Publish request) {
    return rules.publish(id, request.revision());
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
