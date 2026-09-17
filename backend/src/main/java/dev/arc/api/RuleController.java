package dev.arc.api;

import dev.arc.engine.GraphPlan;
import dev.arc.engine.Validator;
import dev.arc.model.Definition;
import dev.arc.store.RuleService;
import dev.arc.store.RuleService.*;
import dev.arc.store.RuleStore;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api")
public class RuleController {
  private final RuleStore store;
  private final RuleService service;

  public RuleController(RuleStore store, RuleService service) {
    this.store = store;
    this.service = service;
  }

  @GetMapping("/rules")
  public Object list() {
    return store.list();
  }

  @PostMapping("/rules")
  @ResponseStatus(HttpStatus.CREATED)
  public Object create(@RequestBody Create request) {
    return service.create(request);
  }

  @GetMapping("/rules/{id}")
  public Object get(@PathVariable String id) {
    return store.get(id);
  }

  @PutMapping("/rules/{id}")
  public Object update(@PathVariable String id, @RequestBody Update request) {
    return service.update(id, request);
  }

  @PostMapping("/rules/{id}/publish")
  public Object publish(@PathVariable String id, @RequestBody Publish request) {
    return service.publish(id, request.revision());
  }

  @GetMapping("/rules/{id}/versions")
  public Object versions(@PathVariable String id) {
    return store.versions(id);
  }

  @GetMapping("/rules/{id}/versions/{version}")
  public Object version(@PathVariable String id, @PathVariable int version) {
    return store.version(id, version);
  }

  @PostMapping("/rules/{id}/execute")
  public Object execute(@PathVariable String id, @RequestBody Execution request) {
    return service.execute(id, request);
  }

  @PostMapping("/preview")
  public Object preview(@RequestBody Preview request) {
    return service.preview(request);
  }

  @PostMapping("/variables")
  public Object variables(@RequestBody Definition definition) {
    new Validator().shape(definition);
    return new GraphPlan(definition).available;
  }

  @PostMapping("/validate")
  public Object validate(@RequestBody Definition definition) {
    service.validate(definition);
    return Map.of("valid", true);
  }
}
