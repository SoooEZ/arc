package dev.arc.api;

import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import dev.arc.model.*;
import dev.arc.rule.*;
import dev.arc.source.*;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class CatalogControllerTest {
  private final RuleRepository rules = mock(RuleRepository.class);
  private final SourceRepository sources = mock(SourceRepository.class);
  private final org.springframework.test.web.servlet.MockMvc mvc =
      MockMvcBuilders.standaloneSetup(
              new RuleController(
                  new RuleService(rules, null, null), mock(RuleExecutionService.class)),
              new SourceController(
                  new SourceService(sources, null), mock(SourceExecutionService.class)))
          .setControllerAdvice(new Errors())
          .build();

  @Test
  void ruleCatalogUsesBoundedMetadataAndPassesSearchFilters() throws Exception {
    var summary =
        new RuleSummary(
            "example", "Example", "", "FORMULA", 2, 1, Instant.EPOCH, Instant.EPOCH, 3, 1, 0);
    when(rules.catalog(20, 10, "Example", "FORMULA", true))
        .thenReturn(new CatalogPage<>(List.of(summary), 21, 20, 10));
    mvc.perform(
            get("/api/rule-summaries")
                .param("offset", "20")
                .param("limit", "10")
                .param("search", "Example")
                .param("kind", "FORMULA")
                .param("publishedOnly", "true"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.total").value(21))
        .andExpect(jsonPath("$.items[0].id").value("example"))
        .andExpect(jsonPath("$.items[0].nodeCount").value(3))
        .andExpect(jsonPath("$.items[0].draft").doesNotExist());
    verify(rules).catalog(20, 10, "Example", "FORMULA", true);
    verifyNoMoreInteractions(rules);
  }

  @Test
  void catalogAndHistoryRejectInvalidBoundsBeforeQueryingStorage() throws Exception {
    for (String endpoint :
        List.of(
            "/api/rule-summaries",
            "/api/source-summaries",
            "/api/rules/example/version-summaries",
            "/api/sources/example/version-summaries")) {
      mvc.perform(get(endpoint).param("limit", "101")).andExpect(status().isUnprocessableEntity());
      mvc.perform(get(endpoint).param("limit", "0")).andExpect(status().isUnprocessableEntity());
      mvc.perform(get(endpoint).param("offset", "-1")).andExpect(status().isUnprocessableEntity());
      mvc.perform(get(endpoint).param("offset", "invalid")).andExpect(status().isBadRequest());
    }
    mvc.perform(get("/api/rule-summaries").param("search", "a".repeat(201)))
        .andExpect(status().isUnprocessableEntity());
    mvc.perform(get("/api/source-summaries").param("search", "a".repeat(201)))
        .andExpect(status().isUnprocessableEntity());
    mvc.perform(get("/api/rules/example/version-summaries").param("search", "2".repeat(201)))
        .andExpect(status().isUnprocessableEntity());
    mvc.perform(get("/api/rule-summaries").param("kind", "unknown"))
        .andExpect(status().isUnprocessableEntity());
    verifyNoInteractions(rules, sources);
  }

  @Test
  void sourceAndVersionSummariesExcludeConfigurationWhileLegacyDetailsStayAvailable()
      throws Exception {
    when(sources.catalog(0, 20, ""))
        .thenReturn(
            new CatalogPage<>(List.of(new SourceSummary("table", "Table", 3, "LOOKUP")), 1, 0, 20));
    when(sources.versionSummaries("table", 0, 20))
        .thenReturn(
            new CatalogPage<>(
                List.of(new SourceVersionSummary("table", 3, Instant.EPOCH)), 3, 0, 20));
    when(rules.versionSummaries("example", 0, 20, ""))
        .thenReturn(
            new CatalogPage<>(
                List.of(new RuleVersionSummary("example", 2, Instant.EPOCH)), 2, 0, 20));
    mvc.perform(get("/api/source-summaries"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items[0].kind").value("LOOKUP"))
        .andExpect(jsonPath("$.items[0].definition").doesNotExist());
    mvc.perform(get("/api/sources/table/version-summaries"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items[0].version").value(3))
        .andExpect(jsonPath("$.items[0].definition").doesNotExist());
    mvc.perform(get("/api/rules/example/version-summaries"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items[0].version").value(2))
        .andExpect(jsonPath("$.items[0].definition").doesNotExist());
    verify(rules).versionSummaries("example", 0, 20, "");
    when(rules.list()).thenReturn(List.of());
    when(sources.list()).thenReturn(List.of());
    mvc.perform(get("/api/rules")).andExpect(status().isOk()).andExpect(content().json("[]"));
    mvc.perform(get("/api/sources")).andExpect(status().isOk()).andExpect(content().json("[]"));
    verify(rules).list();
    verify(sources).list();
  }

  @Test
  void versionSummarySearchTrimsTextAndRetainsFilteredPagingAndPublicationMetadata()
      throws Exception {
    var published = Instant.parse("2026-09-26T12:00:00Z");
    when(rules.versionSummaries("example", 1, 1, "2"))
        .thenReturn(
            new CatalogPage<>(List.of(new RuleVersionSummary("example", 12, published)), 3, 1, 1));
    mvc.perform(
            get("/api/rules/example/version-summaries")
                .param("search", " 2 ")
                .param("offset", "1")
                .param("limit", "1"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.total").value(3))
        .andExpect(jsonPath("$.offset").value(1))
        .andExpect(jsonPath("$.limit").value(1))
        .andExpect(jsonPath("$.items[0].version").value(12))
        .andExpect(jsonPath("$.items[0].publishedAt").value(published.getEpochSecond()))
        .andExpect(jsonPath("$.items[0].definition").doesNotExist());
    verify(rules).versionSummaries("example", 1, 1, "2");
    verifyNoMoreInteractions(rules);
  }

  @Test
  void blankVersionSearchRetainsDefaultHistoryAndMaximumSearchLengthIsAccepted() throws Exception {
    for (String search : List.of("", "2".repeat(200))) {
      when(rules.versionSummaries("example", 0, 20, search))
          .thenReturn(new CatalogPage<>(List.of(), 0, 0, 20));
      mvc.perform(
              get("/api/rules/example/version-summaries")
                  .param("search", search.isEmpty() ? "   " : search))
          .andExpect(status().isOk())
          .andExpect(jsonPath("$.items").isEmpty())
          .andExpect(jsonPath("$.total").value(0));
      verify(rules).versionSummaries("example", 0, 20, search);
    }
    verifyNoMoreInteractions(rules);
  }
}
