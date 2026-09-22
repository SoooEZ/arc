package dev.arc.api;

import dev.arc.engine.validation.Validator;
import dev.arc.model.Definition;
import dev.arc.rule.RuleDefinitionService;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api")
public class GraphController {
  public record Validation(boolean valid) {}

  private final RuleDefinitionService definitions;

  public GraphController(RuleDefinitionService definitions) {
    this.definitions = definitions;
  }

  @PostMapping("/variables")
  public Map<String, Set<String>> variables(@RequestBody Definition definition) {
    return definitions.variables(definition);
  }

  @PostMapping("/validate")
  public Validation validate(@RequestBody Definition definition) {
    definitions.validate(definition);
    return new Validation(true);
  }

  @PostMapping("/diagnostics")
  public List<Validator.Problem> diagnostics(@RequestBody Definition definition) {
    return definitions.diagnostics(definition);
  }
}
