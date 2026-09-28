package dev.arc.api;

import static org.assertj.core.api.Assertions.*;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import dev.arc.model.Definition;
import dev.arc.model.Handles;
import java.io.IOException;
import java.lang.reflect.Method;
import java.lang.reflect.RecordComponent;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;
import java.util.regex.Pattern;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.ClassPathScanningCandidateComponentProvider;
import org.springframework.core.type.filter.AnnotationTypeFilter;
import org.springframework.web.bind.annotation.*;
import org.yaml.snakeyaml.Yaml;

/**
 * docs/openapi.yaml describes the served API: every controller mapping, every node property and
 * every trace branch. Clients generated from the specification otherwise drop or reject them.
 */
class OpenApiContractTest {
  private static final Path SPECIFICATION = Path.of("..", "docs", "openapi.yaml");
  private static Map<String, Object> spec;

  /**
   * The specification lives in the repository's docs, outside the Docker build's backend/ context.
   */
  @BeforeAll
  static void loadTheSpecification() throws IOException {
    assumeTrue(
        Files.exists(SPECIFICATION),
        "docs/openapi.yaml is not in this build context; run mvn verify from a repository checkout");
    try (var input = Files.newInputStream(SPECIFICATION)) {
      spec = new Yaml().load(input);
    }
  }

  @Test
  void everyControllerMappingHasItsPathAndMethodInTheSpecification() throws Exception {
    var scanner = new ClassPathScanningCandidateComponentProvider(false);
    scanner.addIncludeFilter(new AnnotationTypeFilter(RestController.class));
    var served = new TreeSet<String>();
    for (var candidate : scanner.findCandidateComponents("dev.arc.api")) {
      Class<?> controller = Class.forName(candidate.getBeanClassName());
      // The servers of the specification carry the /api prefix.
      assertThat(controller.getAnnotation(RequestMapping.class).value()).containsExactly("/api");
      for (Method method : controller.getDeclaredMethods()) served.addAll(mappings(method));
    }
    assertThat(served).hasSizeGreaterThan(25);
    var documented = new TreeSet<String>();
    section(spec, "paths")
        .forEach(
            (path, operations) -> {
              for (Object verb : ((Map<?, ?>) operations).keySet())
                documented.add(verb + " " + path);
            });
    assertThat(documented).containsAll(served);
  }

  /** "post /rules/{id}/publish" for each request mapping of a controller method. */
  private static List<String> mappings(Method method) {
    var mappings = new ArrayList<String>();
    GetMapping get = method.getAnnotation(GetMapping.class);
    if (get != null) for (String path : get.value()) mappings.add("get " + path);
    PostMapping post = method.getAnnotation(PostMapping.class);
    if (post != null) for (String path : post.value()) mappings.add("post " + path);
    PutMapping put = method.getAnnotation(PutMapping.class);
    if (put != null) for (String path : put.value()) mappings.add("put " + path);
    DeleteMapping delete = method.getAnnotation(DeleteMapping.class);
    if (delete != null) for (String path : delete.value()) mappings.add("delete " + path);
    return mappings;
  }

  @Test
  void theNodeSchemaListsEveryNodeProperty() {
    // A generated client that keeps only declared properties would drop outputName on a save.
    var schema =
        section(
            spec,
            "components",
            "schemas",
            "Definition",
            "properties",
            "nodes",
            "items",
            "properties");
    var components =
        Arrays.stream(Definition.Node.class.getRecordComponents())
            .map(RecordComponent::getName)
            .toList();
    assertThat(schema.keySet()).containsExactlyInAnyOrderElementsOf(components);
  }

  @Test
  void theTraceBranchPatternAcceptsEveryHandle() {
    var branch =
        section(
            spec,
            "components",
            "responses",
            "Execution",
            "content",
            "application/json",
            "schema",
            "properties",
            "trace",
            "items",
            "properties",
            "branch");
    var pattern = Pattern.compile((String) branch.get("pattern"));
    for (String handle :
        List.of(
            Handles.NEXT,
            Handles.condition(true),
            Handles.condition(false),
            Handles.DEFAULT,
            Handles.forCase("big")))
      assertThat(pattern.matcher(handle).matches()).as(handle).isTrue();
    assertThat(branch.get("nullable")).isEqualTo(true);
  }

  @SuppressWarnings("unchecked")
  private static Map<String, Object> section(Map<String, Object> root, String... keys) {
    Map<String, Object> current = root;
    for (String key : keys) {
      Object next = current.get(key);
      assertThat(next).as(String.join("/", keys) + " at " + key).isInstanceOf(Map.class);
      current = (Map<String, Object>) next;
    }
    return current;
  }
}
