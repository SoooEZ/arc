package dev.arc.api;

import dev.arc.model.*;
import dev.arc.source.SourceExecutionService;
import dev.arc.source.SourceService;
import java.util.List;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api")
public class SourceController {
  public record TestResult(Object result) {}

  private final SourceService sources;
  private final SourceExecutionService execution;

  public SourceController(SourceService sources, SourceExecutionService execution) {
    this.sources = sources;
    this.execution = execution;
  }

  @GetMapping("/sources")
  public List<DataSource> list() {
    return sources.list();
  }

  @GetMapping("/source-summaries")
  public CatalogPage<SourceSummary> catalog(
      @RequestParam(defaultValue = "0") int offset,
      @RequestParam(defaultValue = "20") int limit,
      @RequestParam(defaultValue = "") String search) {
    return sources.catalog(offset, limit, search);
  }

  @GetMapping("/sources/{id}/version-summaries")
  public CatalogPage<SourceVersionSummary> versionSummaries(
      @PathVariable String id,
      @RequestParam(defaultValue = "0") int offset,
      @RequestParam(defaultValue = "20") int limit) {
    return sources.versionSummaries(id, offset, limit);
  }

  @PostMapping("/sources")
  public DataSource create(@RequestBody SourceService.Create request) {
    return sources.create(request);
  }

  @PutMapping("/sources/{id}")
  public DataSource update(@PathVariable String id, @RequestBody SourceService.Update request) {
    return sources.update(id, request);
  }

  @GetMapping("/sources/{id}/versions")
  public List<DataSource> versions(@PathVariable String id) {
    return sources.versions(id);
  }

  @GetMapping("/sources/{id}/versions/{version}")
  public DataSource get(@PathVariable String id, @PathVariable int version) {
    return sources.get(id, version);
  }

  @PostMapping("/sources/{id}/test")
  public TestResult test(
      @PathVariable String id, @RequestBody SourceExecutionService.Test request) {
    return new TestResult(execution.test(id, request));
  }
}
