package dev.arc.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.request;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import dev.arc.engine.script.ArcScript;
import dev.arc.rule.RuleDefinitionService;
import jakarta.servlet.ReadListener;
import jakarta.servlet.ServletInputStream;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.List;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.ApplicationContext;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.RequestBuilder;
import org.springframework.web.filter.FormContentFilter;

/**
 * The body limit in Spring Boot's filter chain, configured by application.yaml. Requests go through
 * every registered filter in Boot's order before reaching the real controller.
 */
@WebMvcTest(StudioController.class)
class RequestLimitWebTest {
  private static final int LIMIT = RequestLimitFilter.MAX_BODY_BYTES;

  /** Spring routes the decoded path: ";x=1" is a path parameter and "%61" is "a". */
  private static final List<String> BUILD_PATH_SPELLINGS =
      List.of(
          "/api/studio/build",
          "/api;x=1/studio/build",
          "/api;/studio/build",
          "/%61pi/studio/build",
          "/%61%70%69/studio/build");

  @Autowired private MockMvc mvc;
  @Autowired private ApplicationContext context;
  @MockitoBean private ArcScript script;
  @MockitoBean private RuleDefinitionService definitions;

  @Test
  void everyPathSpellingAndMethodIsCapped() throws Exception {
    byte[] oversized = json("x".repeat(LIMIT));
    for (String path : BUILD_PATH_SPELLINGS) {
      for (HttpMethod method :
          List.of(
              HttpMethod.POST,
              HttpMethod.PUT,
              HttpMethod.PATCH,
              HttpMethod.DELETE,
              HttpMethod.GET)) {
        mvc.perform(
                request(method, URI.create(path))
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(oversized))
            .andExpect(status().isPayloadTooLarge())
            .andExpect(jsonPath("$.message").value("Request body exceeds 1 MiB"));
      }
    }
    verifyNoInteractions(script, definitions);
  }

  @Test
  void chunkedBodiesAreCutOneByteAfterTheLimit() throws Exception {
    String longestSource = "x".repeat(LIMIT - json("").length);
    byte[] atLimit = json(longestSource);
    assertThat(atLimit).hasSize(LIMIT);
    mvc.perform(
            chunked(HttpMethod.POST, "/api;x=1/studio/build", MediaType.APPLICATION_JSON, atLimit))
        .andExpect(status().isOk());
    verify(script).build(longestSource);

    var form = new GeneratedBody(8L * LIMIT);
    mvc.perform(
            chunked(HttpMethod.PUT, "/api/rules/demo", MediaType.APPLICATION_FORM_URLENCODED, form))
        .andExpect(status().isPayloadTooLarge());
    assertThat(form.consumed()).isEqualTo(LIMIT + 1);
    assertThat(context.getBeansOfType(FormContentFilter.class))
        .as("no endpoint accepts form bodies")
        .isEmpty();
  }

  @Test
  void boundedBodiesReachTheControllerThroughEverySpelling() throws Exception {
    for (String path : BUILD_PATH_SPELLINGS)
      mvc.perform(
              post(URI.create(path))
                  .contentType(MediaType.APPLICATION_JSON)
                  .content(json("schema 1;")))
          .andExpect(status().isOk());
    verify(script, times(BUILD_PATH_SPELLINGS.size())).build("schema 1;");
  }

  /**
   * The 413 comes from the filter, before Spring MVC applies the API's CORS policy, so it states
   * the policy's origin itself; a browser on another origin reads both answers.
   */
  @Test
  void theLimitAnswersWithTheApiCorsOrigin() throws Exception {
    mvc.perform(
            post("/api/studio/build")
                .header("Origin", "https://editor.example")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json("x".repeat(LIMIT))))
        .andExpect(status().isPayloadTooLarge())
        .andExpect(header().string("Access-Control-Allow-Origin", ApiCors.ALLOWED_ORIGIN));
    mvc.perform(
            post("/api/studio/build")
                .header("Origin", "https://editor.example")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json("schema 1;")))
        .andExpect(status().isOk())
        .andExpect(header().string("Access-Control-Allow-Origin", ApiCors.ALLOWED_ORIGIN));
  }

  /** A deployment that turns form parsing back on still applies the limit first. */
  @Nested
  @TestPropertySource(properties = "spring.mvc.formcontent.filter.enabled=true")
  class WithFormParsingEnabled {
    @Autowired private MockMvc formMvc;
    @Autowired private ApplicationContext formContext;

    @Test
    void theLimitRunsBeforeTheFormFilterReadsTheBody() throws Exception {
      assertThat(formContext.getBeansOfType(FormContentFilter.class)).isNotEmpty();
      for (HttpMethod method : List.of(HttpMethod.PUT, HttpMethod.PATCH, HttpMethod.DELETE)) {
        var form = new GeneratedBody(8L * LIMIT);
        formMvc
            .perform(
                chunked(method, "/api/rules/demo", MediaType.APPLICATION_FORM_URLENCODED, form))
            .andExpect(status().isPayloadTooLarge());
        assertThat(form.consumed()).as(method.name()).isEqualTo(LIMIT + 1);
      }
    }
  }

  private static byte[] json(String source) {
    return ("{\"source\":\"" + source + "\"}").getBytes(StandardCharsets.UTF_8);
  }

  private static RequestBuilder chunked(
      HttpMethod method, String path, MediaType type, byte[] content) {
    return chunked(method, path, type, new GeneratedBody(content));
  }

  /** A request without Content-Length, as sent with chunked transfer encoding. */
  private static RequestBuilder chunked(
      HttpMethod method, String path, MediaType type, ServletInputStream body) {
    return servletContext -> {
      var request =
          new MockHttpServletRequest(servletContext, method.name(), path) {
            @Override
            public ServletInputStream getInputStream() {
              return body;
            }

            @Override
            public int getContentLength() {
              return -1;
            }

            @Override
            public long getContentLengthLong() {
              return -1;
            }
          };
      request.setContentType(type.toString());
      return request;
    };
  }

  /** Streams fixed bytes, or "k=vvv..." form content, and counts what the server reads. */
  private static final class GeneratedBody extends ServletInputStream {
    private final byte[] content;
    private final long size;
    private long consumed;

    GeneratedBody(byte[] content) {
      this.content = content;
      this.size = content.length;
    }

    GeneratedBody(long size) {
      this.content = null;
      this.size = size;
    }

    long consumed() {
      return consumed;
    }

    @Override
    public int read() {
      if (consumed >= size) return -1;
      return byteAt(consumed++) & 0xff;
    }

    @Override
    public int read(byte[] buffer, int offset, int length) {
      if (consumed >= size) return -1;
      int count = (int) Math.min(length, size - consumed);
      for (int index = 0; index < count; index++) buffer[offset + index] = byteAt(consumed + index);
      consumed += count;
      return count;
    }

    private byte byteAt(long position) {
      if (content != null) return content[(int) position];
      if (position == 0) return 'k';
      if (position == 1) return '=';
      return 'v';
    }

    @Override
    public boolean isFinished() {
      return consumed >= size;
    }

    @Override
    public boolean isReady() {
      return true;
    }

    @Override
    public void setReadListener(ReadListener listener) {
      throw new UnsupportedOperationException();
    }
  }
}
