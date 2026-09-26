package dev.arc.api;

import dev.arc.engine.expression.Functions;
import dev.arc.engine.script.ArcScript;
import dev.arc.model.Definition;
import dev.arc.rule.RuleDefinitionService;
import java.util.Map;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api")
public class StudioController {
  private final ArcScript script;
  private final RuleDefinitionService definitions;

  public StudioController(ArcScript script, RuleDefinitionService definitions) {
    this.script = script;
    this.definitions = definitions;
  }

  public record Code(String source) {}

  public record ExpressionCode(String expression) {}

  @PostMapping("/studio/expression/check")
  public ArcScript.ExpressionCheck checkExpression(@RequestBody ExpressionCode code) {
    return definitions.checkExpression(code.expression());
  }

  public record NodeCode(Definition definition, String nodeId, String source) {}

  @PostMapping("/studio/node/render")
  public Map<String, String> renderNode(@RequestBody NodeCode code) {
    return Map.of("source", script.renderNode(code.definition(), code.nodeId()));
  }

  @PostMapping("/studio/node/build")
  public ArcScript.Build buildNode(@RequestBody NodeCode code) {
    return script.buildNode(code.definition(), code.nodeId(), code.source());
  }

  @GetMapping("/functions")
  public java.util.List<Functions.Entry> functions() {
    return Functions.catalog();
  }

  @PostMapping("/studio/build")
  public ArcScript.Build build(@RequestBody Code code) {
    return script.build(code.source());
  }

  @PostMapping("/studio/render")
  public Map<String, String> render(@RequestBody Definition definition) {
    return Map.of("source", script.render(definition));
  }
}
