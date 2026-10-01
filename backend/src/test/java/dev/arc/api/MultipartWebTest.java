package dev.arc.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import dev.arc.engine.script.ArcScript;
import dev.arc.rule.RuleDefinitionService;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.Part;
import java.nio.charset.StandardCharsets;
import java.util.Collection;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.ImportAutoConfiguration;
import org.springframework.boot.autoconfigure.web.servlet.MultipartAutoConfiguration;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.ApplicationContext;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.RequestBuilder;
import org.springframework.web.multipart.MultipartResolver;

/**
 * No endpoint accepts multipart bodies, so the application parses none (application.yaml). Tomcat
 * fails to parse a multipart body without a boundary, and that failure was an unhandled 500 with an
 * ERROR log on every path, before any controller was chosen.
 */
@WebMvcTest(StudioController.class)
// The running application's multipart configuration, which @WebMvcTest leaves out.
@ImportAutoConfiguration(MultipartAutoConfiguration.class)
class MultipartWebTest {
  @Autowired private MockMvc mvc;
  @Autowired private ApplicationContext context;
  @MockitoBean private ArcScript script;
  @MockitoBean private RuleDefinitionService definitions;

  @Test
  void aMultipartBodyIsAnUnsupportedTypeEvenWhenItsPartsCannotBeParsed() throws Exception {
    mvc.perform(unparsableMultipart("/api/studio/build"))
        .andExpect(status().isUnsupportedMediaType())
        .andExpect(jsonPath("$.status").value(415));
    mvc.perform(unparsableMultipart("/api/no-such-endpoint")).andExpect(status().isNotFound());
    verifyNoInteractions(script, definitions);
    assertThat(context.getBeansOfType(MultipartResolver.class))
        .as("no endpoint accepts multipart bodies")
        .isEmpty();
  }

  /** A multipart request whose parts fail to parse, as Tomcat's do without a boundary. */
  private static RequestBuilder unparsableMultipart(String path) {
    return servletContext -> {
      var request =
          new MockHttpServletRequest(servletContext, "POST", path) {
            @Override
            public Collection<Part> getParts() throws ServletException {
              throw new ServletException(
                  "the request was rejected because no multipart boundary was found");
            }
          };
      request.setContentType("multipart/form-data");
      request.setContent("x".getBytes(StandardCharsets.UTF_8));
      return request;
    };
  }
}
