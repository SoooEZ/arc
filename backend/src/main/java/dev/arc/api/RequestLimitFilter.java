package dev.arc.api;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ReadListener;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletInputStream;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import jakarta.servlet.http.HttpServletResponse;
import java.io.*;
import java.nio.charset.StandardCharsets;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Enforce the same bound on the direct API port as on the Nginx proxy, including chunked bodies.
 */
@Component
public class RequestLimitFilter extends OncePerRequestFilter {
  private static final int MAX_BODY = 1024 * 1024;

  @Override
  protected boolean shouldNotFilter(HttpServletRequest request) {
    return !request.getRequestURI().startsWith("/api/")
        || !(request.getMethod().equals("POST") || request.getMethod().equals("PUT"));
  }

  @Override
  protected void doFilterInternal(
      HttpServletRequest request, HttpServletResponse response, FilterChain chain)
      throws ServletException, IOException {
    byte[] body =
        request.getContentLengthLong() > MAX_BODY
            ? null
            : request.getInputStream().readNBytes(MAX_BODY + 1);
    if (body == null || body.length > MAX_BODY) {
      response.setStatus(413);
      response.setContentType("application/json");
      response.setHeader("Access-Control-Allow-Origin", "*");
      response
          .getWriter()
          .write("{\"status\":413,\"message\":\"Request body exceeds 1 MiB\",\"issues\":[]}");
      return;
    }
    chain.doFilter(
        new HttpServletRequestWrapper(request) {
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
            return new BufferedReader(
                new InputStreamReader(getInputStream(), StandardCharsets.UTF_8));
          }
        },
        response);
  }
}
