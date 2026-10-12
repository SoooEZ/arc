package dev.arc.api;

import static org.assertj.core.api.Assertions.*;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.arc.model.Definition;
import dev.arc.model.Handles;
import dev.arc.model.NodeKind;
import dev.arc.model.RuleKind;
import dev.arc.source.SourceAdapter;
import dev.arc.source.http.HttpSource;
import dev.arc.source.http.HttpSourceAdapter;
import dev.arc.source.lookup.LookupSourceAdapter;
import java.io.IOException;
import java.lang.reflect.Method;
import java.lang.reflect.RecordComponent;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;
import java.util.regex.Pattern;
import java.util.stream.Stream;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.ClassPathScanningCandidateComponentProvider;
import org.springframework.core.type.filter.AnnotationTypeFilter;
import org.springframework.core.type.filter.AssignableTypeFilter;
import org.springframework.web.bind.annotation.*;
import org.yaml.snakeyaml.Yaml;

/**
 * docs/openapi.yaml describes the served API: exactly the controller mappings, every node property,
 * every trace branch and the server's kind vocabularies. Clients generated from the specification
 * otherwise drop or reject them.
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

  /** The keys of a path item that are operations; a path item also lists its parameters. */
  private static final Set<String> HTTP_VERBS =
      Set.of("get", "put", "post", "delete", "options", "head", "patch", "trace");

  /**
   * Documented and served operations are the same set: a served operation the specification lacks
   * is invisible to generated clients, and a documented one the server lacks would be called.
   */
  @Test
  void theSpecificationListsExactlyTheServedPathsAndMethods() throws Exception {
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
            (path, item) -> {
              for (Object key : ((Map<?, ?>) item).keySet())
                if (HTTP_VERBS.contains(key)) documented.add(key + " " + path);
            });
    assertThat(documented).isEqualTo(served);
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
    PatchMapping patch = method.getAnnotation(PatchMapping.class);
    if (patch != null) for (String path : patch.value()) mappings.add("patch " + path);
    RequestMapping generic = method.getAnnotation(RequestMapping.class);
    if (generic != null)
      for (RequestMethod verb : generic.method())
        for (String path : generic.value())
          mappings.add(verb.name().toLowerCase(Locale.ROOT) + " " + path);
    return mappings;
  }

  /**
   * The kind vocabularies the specification spells, node types, rule kinds and source kinds, are
   * the server's own: {@link NodeKind}, {@link RuleKind} and the registered source adapters, in
   * their order. A generated client would otherwise refuse a kind the server accepts, or offer one
   * it does not, and the source kinds were listed in two orders.
   */
  @Test
  void theKindEnumsAreTheServersVocabularies() throws Exception {
    List<String> nodeKinds = Arrays.stream(NodeKind.values()).map(Enum::name).toList();
    List<String> ruleKinds = Arrays.stream(RuleKind.values()).map(Enum::name).toList();
    List<String> sourceKinds = registeredSourceKinds();
    var enums = new LinkedHashMap<String, List<String>>();
    collectEnums("", spec, enums);
    var vocabularies = new LinkedHashMap<List<String>, Integer>();
    enums.forEach(
        (path, values) -> {
          List<String> expected =
              values.contains("INPUT")
                  ? nodeKinds
                  : values.contains("DECISION_TREE")
                      ? ruleKinds
                      : values.contains("HTTP") || values.contains("LOOKUP") ? sourceKinds : null;
          if (expected == null) return;
          assertThat(values).as(path).isEqualTo(expected);
          vocabularies.merge(expected, 1, Integer::sum);
        });
    assertThat(vocabularies.getOrDefault(nodeKinds, 0)).as("node type enums").isEqualTo(1);
    assertThat(vocabularies.getOrDefault(ruleKinds, 0)).as("rule kind enums").isGreaterThan(1);
    assertThat(vocabularies.getOrDefault(sourceKinds, 0)).as("source kind enums").isEqualTo(2);
  }

  /** Every string enum of the specification by its path. */
  private static void collectEnums(String path, Object node, Map<String, List<String>> enums) {
    if (node instanceof Map<?, ?> map) {
      if (map.get("enum") instanceof List<?> values
          && !values.isEmpty()
          && values.stream().allMatch(String.class::isInstance))
        enums.put(path, values.stream().map(String.class::cast).toList());
      map.forEach((key, value) -> collectEnums(path + "/" + key, value, enums));
    } else if (node instanceof List<?> items) {
      for (int index = 0; index < items.size(); index++)
        collectEnums(path + "[" + index + "]", items.get(index), enums);
    }
  }

  /**
   * The kinds of the registered adapters, in the order the registry's own message lists them. The
   * adapters are built by hand from the classes the scan finds, so a new adapter fails here until
   * it is added, with its kind, to the specification.
   */
  private static List<String> registeredSourceKinds() throws Exception {
    var scanner = new ClassPathScanningCandidateComponentProvider(false);
    scanner.addIncludeFilter(new AssignableTypeFilter(SourceAdapter.class));
    var registered = new TreeSet<String>();
    for (var candidate : scanner.findCandidateComponents("dev.arc.source"))
      registered.add(candidate.getBeanClassName());
    assertThat(registered)
        .containsExactly(HttpSourceAdapter.class.getName(), LookupSourceAdapter.class.getName());
    try (var http = new HttpSource(new ObjectMapper(), "", "")) {
      return Stream.of(new HttpSourceAdapter(http), new LookupSourceAdapter())
          .map(SourceAdapter::kind)
          .sorted()
          .toList();
    }
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
