package dev.arc.api;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.arc.engine.execution.Engine;
import dev.arc.engine.validation.Validator;
import dev.arc.persistence.JdbcRuleRepository;
import dev.arc.persistence.JdbcSourceRepository;
import dev.arc.persistence.JsonCodec;
import dev.arc.rule.RuleDefinitionService;
import dev.arc.rule.RuleExecutionService;
import dev.arc.rule.RuleService;
import dev.arc.source.SourceExecutionService;
import dev.arc.source.SourceService;
import dev.arc.source.SourceValidator;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

/**
 * Storage outcomes reach clients as errors about the requested resource. The real controllers,
 * services and JDBC repositories run over a JdbcTemplate that stores nothing: every lookup finds no
 * row.
 */
class ResourceErrorsTest {
  private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
  private final JsonCodec json = new JsonCodec(new ObjectMapper());
  private final MockMvc mvc =
      MockMvcBuilders.standaloneSetup(
              new RuleController(
                  new RuleService(
                      new JdbcRuleRepository(jdbc, json),
                      new Validator(),
                      mock(RuleDefinitionService.class),
                      mock(Engine.class)),
                  mock(RuleExecutionService.class)),
              new SourceController(
                  new SourceService(
                      new JdbcSourceRepository(jdbc, json), mock(SourceValidator.class)),
                  mock(SourceExecutionService.class)))
          .setControllerAdvice(new Errors())
          .build();

  @Test
  void aTakenIdIsAConflictAboutTheResourceBeingCreated() throws Exception {
    when(jdbc.update(anyString(), any(Object[].class)))
        .thenThrow(new DuplicateKeyException("duplicate key value violates unique constraint"));

    mvc.perform(
            post("/api/sources")
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    """
                    {"id":"country-tax","name":"Country tax rates","definition":
                      {"kind":"LOOKUP","parameters":[],"entries":{},"timeoutMs":3000}}
                    """))
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.message").value("This source ID already exists"));
    mvc.perform(
            post("/api/rules")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"id\":\"order-pricing\",\"name\":\"Order pricing\",\"kind\":\"RULE\"}"))
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.message").value("This rule ID already exists"));
  }

  @Test
  void textThatPostgresqlCannotStoreIsRejectedBeforeWriting() throws Exception {
    mvc.perform(
            post("/api/rules")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"id\":\"nul-name\",\"name\":\"Bad\\u0000name\",\"kind\":\"RULE\"}"))
        .andExpect(status().isUnprocessableEntity())
        .andExpect(jsonPath("$.message").value("Text cannot contain the NUL character (U+0000)"));
    mvc.perform(
            post("/api/sources")
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    """
                    {"id":"nul-entry","name":"Entries","definition":
                      {"kind":"LOOKUP","parameters":[],"entries":{"US":"a\\u0000b"},"timeoutMs":3000}}
                    """))
        .andExpect(status().isUnprocessableEntity())
        .andExpect(jsonPath("$.message").value("Text cannot contain the NUL character (U+0000)"));
    // An unpaired surrogate was stored as '?' with 201; control characters were trimmed away.
    mvc.perform(
            post("/api/rules")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"id\":\"lone-surrogate\",\"name\":\"a\\ud800b\",\"kind\":\"RULE\"}"))
        .andExpect(status().isUnprocessableEntity())
        .andExpect(jsonPath("$.message").value("Text cannot contain an unpaired UTF-16 surrogate"));
    mvc.perform(
            post("/api/rules")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"id\":\"control-name\",\"name\":\"\\u0001x\",\"kind\":\"RULE\"}"))
        .andExpect(status().isUnprocessableEntity())
        .andExpect(jsonPath("$.message").value("Rule name cannot contain control characters"));
    verify(jdbc, never()).update(anyString(), any(Object[].class));
  }

  @Test
  void errorsStayJsonWhateverTheClientAccepts() throws Exception {
    // Content negotiation failed inside the handler before, turning every error into an empty 500.
    for (MediaType accept :
        List.of(MediaType.TEXT_PLAIN, MediaType.APPLICATION_XML, MediaType.TEXT_HTML))
      mvc.perform(get("/api/rules/missing/versions").accept(accept))
          .andExpect(status().isNotFound())
          .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
          .andExpect(jsonPath("$.message").value("Rule not found: missing"))
          .andExpect(jsonPath("$.locations").isArray());
    mvc.perform(
            post("/api/rules")
                .contentType(MediaType.APPLICATION_JSON)
                .accept(MediaType.TEXT_PLAIN)
                .content("{\"id\":\"Bad ID\",\"name\":\"Name\",\"kind\":\"RULE\"}"))
        .andExpect(status().isUnprocessableEntity())
        .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON));
  }

  @Test
  void anUnknownSourceHasNoVersionHistory() throws Exception {
    for (String history :
        new String[] {
          "/api/sources/misspelled/versions", "/api/sources/misspelled/version-summaries"
        })
      mvc.perform(get(history))
          .andExpect(status().isNotFound())
          .andExpect(jsonPath("$.message").value("Source not found"));
    mvc.perform(get("/api/rules/misspelled/versions"))
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.message").value("Rule not found: misspelled"));
  }
}
