package dev.arc.source;

import static org.assertj.core.api.Assertions.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.junit.jupiter.api.Test;

class HttpSourceTest {
  private SourceService.Config config(String url, int timeout) {
    return new SourceService.Config("HTTP", url, List.of(), null, Map.of(), timeout);
  }

  @Test
  void blocksPrivateDestinationsByDefaultAndRequiresHostAllowlistForSecrets() throws Exception {
    var http = new HttpSource(new ObjectMapper(), "", "");
    for (String host :
        List.of("127.0.0.1", "169.254.169.254", "10.0.0.1", "::1", "100.100.100.200"))
      assertThatThrownBy(() -> http.resolve(host)).isInstanceOf(UnknownHostException.class);
    assertThatThrownBy(() -> http.validate(config("file:///etc/passwd", 1000)))
        .hasMessageContaining("HTTP");
    assertThatThrownBy(
            () ->
                http.validate(
                    new SourceService.Config(
                        "HTTP",
                        "https://example.com",
                        List.of(),
                        null,
                        Map.of("Authorization", "TOKEN"),
                        1000)))
        .hasMessageContaining("allowlisted");
  }

  @Test
  void configuredInternalEndpointSupportsEncodedParametersAndRejectsRedirectsAndTimeouts()
      throws Exception {
    var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext(
        "/json",
        exchange -> {
          String query = exchange.getRequestURI().getRawQuery();
          byte[] b =
              ("{\"query\":\"" + query + "\",\"rate\":0.2}").getBytes(StandardCharsets.UTF_8);
          exchange.sendResponseHeaders(200, b.length);
          try (var out = exchange.getResponseBody()) {
            out.write(b);
          }
        });
    server.createContext(
        "/redirect",
        exchange -> {
          exchange.getResponseHeaders().add("Location", "/json");
          exchange.sendResponseHeaders(302, -1);
          exchange.close();
        });
    server.createContext(
        "/slow",
        exchange -> {
          try {
            Thread.sleep(800);
            exchange.sendResponseHeaders(200, 2);
            exchange.getResponseBody().write("{}".getBytes());
          } catch (Exception ignored) {
          } finally {
            exchange.close();
          }
        });
    server.start();
    String base = "http://127.0.0.1:" + server.getAddress().getPort();
    try {
      var http = new HttpSource(new ObjectMapper(), "127.0.0.1", "127.0.0.1");
      Object result = http.fetch(config(base + "/json", 1000), Map.of("country", "A&B ?"));
      assertThat(result).isInstanceOf(Map.class);
      assertThat(((Map<?, ?>) result).get("query")).isEqualTo("country=A%26B%20%3F");
      assertThatThrownBy(() -> http.fetch(config(base + "/redirect", 1000), Map.of()))
          .hasMessageContaining("302");
      long before = System.nanoTime();
      assertThatThrownBy(() -> http.fetch(config(base + "/slow", 100), Map.of()))
          .hasMessageContaining("failed");
      assertThat((System.nanoTime() - before) / 1_000_000).isLessThan(1500);
    } finally {
      server.stop(0);
    }
  }
}
