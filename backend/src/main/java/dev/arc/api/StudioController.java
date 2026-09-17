package dev.arc.api;

import dev.arc.engine.*;
import dev.arc.model.Definition;
import dev.arc.source.SourceService;
import java.util.Map;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api")
public class StudioController {
  private final ArcScript script;
  private final SourceService sources;

  public StudioController(ArcScript script, SourceService sources) {
    this.script = script;
    this.sources = sources;
  }

  public record Code(String source) {}

  public record NodeCode(Definition definition, String nodeId, String source) {}

  @PostMapping("/studio/node/render")
  public Object renderNode(@RequestBody NodeCode code) {
    return Map.of("source", script.renderNode(code.definition(), code.nodeId()));
  }

  @PostMapping("/studio/node/build")
  public Object buildNode(@RequestBody NodeCode code) {
    return script.buildNode(code.definition(), code.nodeId(), code.source());
  }

  @GetMapping("/functions")
  public Object functions() {
    return Functions.catalog();
  }

  @PostMapping("/studio/build")
  public Object build(@RequestBody Code code) {
    return script.build(code.source());
  }

  @PostMapping("/studio/render")
  public Object render(@RequestBody Definition definition) {
    return Map.of("source", script.render(definition));
  }

  @GetMapping("/sources")
  public Object list() {
    return sources.list();
  }

  @PostMapping("/sources")
  public Object create(@RequestBody SourceService.Create request) {
    return sources.create(request);
  }

  @PutMapping("/sources/{id}")
  public Object update(@PathVariable String id, @RequestBody SourceService.Update request) {
    return sources.update(id, request);
  }

  @GetMapping("/sources/{id}/versions")
  public Object versions(@PathVariable String id) {
    return sources.versions(id);
  }

  @GetMapping("/sources/{id}/versions/{version}")
  public Object get(@PathVariable String id, @PathVariable int version) {
    return sources.get(id, version);
  }

  @PostMapping("/sources/{id}/test")
  public Object test(@PathVariable String id, @RequestBody SourceService.Test request) {
    Integer version = request.version();
    if (version == null) {
      var all = sources.versions(id);
      if (all.isEmpty()) throw new ArcException(404, "Source not found");
      version = all.getFirst().version();
    }
    return Map.of(
        "result",
        java.util.Optional.ofNullable(sources.fetch(id, version, request.inputs()))
            .orElse(com.fasterxml.jackson.databind.node.NullNode.instance));
  }
}
