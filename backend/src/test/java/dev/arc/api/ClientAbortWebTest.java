package dev.arc.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import java.io.IOException;
import org.apache.catalina.connector.ClientAbortException;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Controller;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseBody;

/**
 * A client that went away mid-response is not a server error: Tomcat raises ClientAbortException on
 * the next socket write, Spring hands it to the catch-all handler before its own
 * disconnected-client check, and the handler logged it at ERROR with a stack trace and wrote a 500
 * into the dead socket. An unexpected exception still answers the 500 body and logs the ERROR.
 */
class ClientAbortWebTest {
  /**
   * Stands in for a response whose write failed, or a handler that broke. A plain Controller, so
   * the OpenAPI contract test's scan for the served RestControllers does not count its paths.
   */
  @Controller
  @RequestMapping("/api")
  static class Failing {
    @GetMapping("/aborted")
    @ResponseBody
    String aborted() throws IOException {
      throw new ClientAbortException(new IOException("Broken pipe"));
    }

    @GetMapping("/broken")
    @ResponseBody
    String broken() {
      throw new IllegalStateException("broken");
    }
  }

  private final MockMvc mvc =
      MockMvcBuilders.standaloneSetup(new Failing()).setControllerAdvice(new Errors()).build();
  private final Logger errors = (Logger) LoggerFactory.getLogger(Errors.class);
  private final ListAppender<ILoggingEvent> logged = new ListAppender<>();

  @BeforeEach
  void captureTheErrorLog() {
    logged.start();
    errors.addAppender(logged);
  }

  @AfterEach
  void releaseTheErrorLog() {
    errors.detachAppender(logged);
  }

  @Test
  void aClientThatWentAwayGetsNoSecondWriteAndNoErrorLogEntry() throws Exception {
    mvc.perform(get("/api/aborted")).andExpect(content().string(""));
    assertThat(logged.list).noneMatch(event -> event.getLevel().isGreaterOrEqual(Level.INFO));
  }

  @Test
  void anUnexpectedFailureStillAnswers500AndLogsTheError() throws Exception {
    mvc.perform(get("/api/broken"))
        .andExpect(status().isInternalServerError())
        .andExpect(jsonPath("$.status").value(500))
        .andExpect(jsonPath("$.message").value("An unexpected server error occurred"))
        .andExpect(jsonPath("$.issues").isEmpty())
        .andExpect(jsonPath("$.locations").isEmpty());
    assertThat(logged.list)
        .singleElement()
        .satisfies(
            event -> {
              assertThat(event.getLevel()).isEqualTo(Level.ERROR);
              assertThat(event.getFormattedMessage()).isEqualTo("Unhandled request error");
              assertThat(event.getThrowableProxy().getClassName())
                  .isEqualTo(IllegalStateException.class.getName());
            });
  }
}
