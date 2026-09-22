package dev.arc.api;

import dev.arc.model.DataSource;
import dev.arc.source.SourceExecutionService;
import dev.arc.source.SourceService;
import java.util.List;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/sources")
public class SourceController {
  public record TestResult(Object result) {}

  private final SourceService sources;
  private final SourceExecutionService execution;

  public SourceController(SourceService sources, SourceExecutionService execution) {
    this.sources = sources;
    this.execution = execution;
  }

  @GetMapping
  public List<DataSource> list() {
    return sources.list();
  }

  @PostMapping
  public DataSource create(@RequestBody SourceService.Create request) {
    return sources.create(request);
  }

  @PutMapping("/{id}")
  public DataSource update(@PathVariable String id, @RequestBody SourceService.Update request) {
    return sources.update(id, request);
  }

  @GetMapping("/{id}/versions")
  public List<DataSource> versions(@PathVariable String id) {
    return sources.versions(id);
  }

  @GetMapping("/{id}/versions/{version}")
  public DataSource get(@PathVariable String id, @PathVariable int version) {
    return sources.get(id, version);
  }

  @PostMapping("/{id}/test")
  public TestResult test(
      @PathVariable String id, @RequestBody SourceExecutionService.Test request) {
    return new TestResult(execution.test(id, request));
  }
}
