package dev.arc.api;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.arc.engine.Limits;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ReadListener;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletInputStream;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import jakarta.servlet.http.HttpServletResponse;
import java.io.*;
import java.nio.charset.StandardCharsets;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Enforce the same bound on the direct API port as on the Nginx proxy, including chunked bodies.
 *
 * <p>Every request is capped, whatever its method or path. Spring routes decoded paths such as
 * {@code /api;x=1/...} and {@code /%61pi/...} to the API, so a check on the raw request URI could
 * be bypassed. The filter runs first, before any other filter (such as form parsing) could read an
 * unbounded body.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class RequestLimitFilter extends OncePerRequestFilter {
  static final int MAX_BODY_BYTES = 1024 * 1024;

  private final ObjectMapper json;

  public RequestLimitFilter(ObjectMapper json) {
    this.json = json;
  }

  @Override
  protected void doFilterInternal(
      HttpServletRequest request, HttpServletResponse response, FilterChain chain)
      throws ServletException, IOException {
    byte[] body = boundedBody(request);
    if (body == null) {
      rejectOversized(response);
      return;
    }
    chain.doFilter(new BufferedBodyRequest(request, body), response);
  }

  /** The complete body, or null when it exceeds the limit. Reads at most one byte past it. */
  private static byte[] boundedBody(HttpServletRequest request) throws IOException {
    if (request.getContentLengthLong() > MAX_BODY_BYTES) return null;
    byte[] body = request.getInputStream().readNBytes(MAX_BODY_BYTES + 1);
    return body.length > MAX_BODY_BYTES ? null : body;
  }

  /** The same error envelope as {@link Errors}, with the limit stated from its constant. */
  private void rejectOversized(HttpServletResponse response) throws IOException {
    response.setStatus(413);
    response.setContentType("application/json");
    response.setHeader("Access-Control-Allow-Origin", ApiCors.ALLOWED_ORIGIN);
    var body =
        ErrorBody.transport(413, "Request body exceeds " + Limits.formatBytes(MAX_BODY_BYTES));
    response.getWriter().write(json.writeValueAsString(body));
  }

  /** Replays the bounded body to later filters and controllers. */
  private static final class BufferedBodyRequest extends HttpServletRequestWrapper {
    private final byte[] body;

    BufferedBodyRequest(HttpServletRequest request, byte[] body) {
      super(request);
      this.body = body;
    }

    @Override
    public ServletInputStream getInputStream() {
      var input = new ByteArrayInputStream(body);
      return new ServletInputStream() {
        @Override
        public int read() {
          return input.read();
        }

        @Override
        public int read(byte[] b, int off, int len) {
          return input.read(b, off, len);
        }

        @Override
        public boolean isFinished() {
          return input.available() == 0;
        }

        @Override
        public boolean isReady() {
          return true;
        }

        @Override
        public void setReadListener(ReadListener listener) {
          throw new UnsupportedOperationException("Synchronous API only");
        }
      };
    }

    @Override
    public BufferedReader getReader() {
      return new BufferedReader(new InputStreamReader(getInputStream(), StandardCharsets.UTF_8));
    }
  }
}
