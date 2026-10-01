package dev.arc.source.http;

import static dev.arc.source.http.HttpDestinationPolicyTest.ipv6;
import static org.assertj.core.api.Assertions.*;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.json.JsonMapper;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import dev.arc.engine.ExecutionDeadline;
import dev.arc.error.ArcException;
import dev.arc.model.SourceDefinition;
import java.io.IOException;
import java.math.BigDecimal;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.Test;

class HttpSourceTest {
  private static final int MIB = 1024 * 1024;

  private SourceDefinition config(String url, int timeout) {
    return new SourceDefinition("HTTP", url, List.of(), null, Map.of(), timeout);
  }

  private static Object fetch(
      HttpSource http, SourceDefinition definition, Map<String, Object> inputs) {
    return http.fetch(
        definition, inputs, ExecutionDeadline.start(ExecutionDeadline.DEFAULT_TIMEOUT_MS));
  }

  @Test
  void enforcesAddressPolicyAtConnectionTimeBeforeSendingARequest() throws Exception {
    var requests = new java.util.concurrent.atomic.AtomicInteger();
    var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext(
        "/",
        exchange -> {
          requests.incrementAndGet();
          byte[] body = "{}".getBytes(StandardCharsets.UTF_8);
          exchange.sendResponseHeaders(200, body.length);
          try (var response = exchange.getResponseBody()) {
            response.write(body);
          }
        });
    server.start();
    try {
      var http = new HttpSource(new ObjectMapper(), "127.0.0.1", "");
      var definition = config("http://127.0.0.1:" + server.getAddress().getPort(), 1000);
      assertThatCode(() -> http.validate(definition)).doesNotThrowAnyException();
      assertThatThrownBy(() -> fetch(http, definition, Map.of())).hasMessageContaining("blocked");
      assertThat(requests).hasValue(0);
    } finally {
      server.stop(0);
    }
  }

  @Test
  void ipv4MappedDnsAnswerCannotReachALoopbackServer() throws Exception {
    var requests = new java.util.concurrent.atomic.AtomicInteger();
    var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext(
        "/",
        exchange -> {
          requests.incrementAndGet();
          respond(exchange, 200, "{\"AccessKeyId\":\"internal\"}");
        });
    server.start();
    var policy = HttpDestinationPolicyTest.answering("", ipv6("::ffff:127.0.0.1"));
    try (var http = new HttpSource(new ObjectMapper(), policy)) {
      var definition =
          config("http://metadata.attacker.example:" + server.getAddress().getPort(), 1000);
      assertThatThrownBy(() -> fetch(http, definition, Map.of())).hasMessageContaining("blocked");
      assertThat(requests).hasValue(0);
    } finally {
      server.stop(0);
    }
  }

  @Test
  void blocksPrivateDestinationsByDefaultAndRequiresHostAllowlistForSecrets() {
    var http = new HttpSource(new ObjectMapper(), "", "");
    assertThatThrownBy(() -> http.validate(config("file:///etc/passwd", 1000)))
        .hasMessageContaining("HTTP");
    assertThatThrownBy(
            () ->
                http.validate(
                    new SourceDefinition(
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
    server.createContext("/json", HttpSourceTest::echoQuery);
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
    try (var http = new HttpSource(new ObjectMapper(), "127.0.0.1", "127.0.0.1")) {
      Object result = fetch(http, config(base + "/json", 1000), Map.of("country", "A&B ?"));
      assertThat(result).isInstanceOf(Map.class);
      assertThat(((Map<?, ?>) result).get("query")).isEqualTo("country=A%26B%20%3F");
      assertThatThrownBy(() -> fetch(http, config(base + "/redirect", 1000), Map.of()))
          .hasMessageContaining("302");
      long before = System.nanoTime();
      assertThatThrownBy(() -> fetch(http, config(base + "/slow", 100), Map.of()))
          .hasMessageContaining("failed");
      assertThat((System.nanoTime() - before) / 1_000_000).isLessThan(1500);
    } finally {
      server.stop(0);
    }
  }

  @Test
  void keepsTheConfiguredQueryTextAndAppendsEncodedParameters() throws Exception {
    var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext("/search", HttpSourceTest::echoQuery);
    server.start();
    String base = "http://127.0.0.1:" + server.getAddress().getPort() + "/search";
    String configured =
        "q=premium+customers&fields=name,email&a=1;b=2&filter=status%3Dopen+AND+owner%3Dme"
            + "&plus=%2B&=x&flag";
    var nullCustomer = new HashMap<String, Object>();
    nullCustomer.put("customerId", null);
    try (var http = new HttpSource(new ObjectMapper(), "", "127.0.0.1")) {
      var definition = config(base + "?" + configured, 1000);
      assertThat(query(fetch(http, definition, Map.of()))).isEqualTo(configured);
      assertThat(query(fetch(http, definition, nullCustomer))).isEqualTo(configured);
      assertThat(query(fetch(http, definition, Map.of("customerId", "C-7 +/"))))
          .isEqualTo(configured + "&customerId=C-7%20%2B%2F");
      assertThat(query(fetch(http, config(base, 1000), Map.of("customerId", "C-7"))))
          .isEqualTo("customerId=C-7");
      assertThat(query(fetch(http, config(base + "?", 1000), Map.of("customerId", "C-7"))))
          .isEqualTo("customerId=C-7");
    } finally {
      server.stop(0);
    }
  }

  @Test
  void aSuppliedParameterStillReplacesTheConfiguredPairWithTheSameName() throws Exception {
    var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext("/rates", HttpSourceTest::echoQuery);
    server.start();
    String base = "http://127.0.0.1:" + server.getAddress().getPort() + "/rates";
    var omitted = new HashMap<String, Object>();
    omitted.put("currency", null);
    try (var http = new HttpSource(new ObjectMapper(), "", "127.0.0.1")) {
      var definition = config(base + "?currency=USD&q=a+b&currency=GBP&%63urrency=CHF", 1000);
      assertThat(query(fetch(http, definition, Map.of("currency", "EUR"))))
          .isEqualTo("q=a+b&currency=EUR");
      assertThat(query(fetch(http, definition, omitted)))
          .isEqualTo("currency=USD&q=a+b&currency=GBP&%63urrency=CHF");
    } finally {
      server.stop(0);
    }
  }

  @Test
  void percentEncodedUrlsReachTheServerByteForByteWhileRawNonAsciiIsRefused() throws Exception {
    var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext("/", HttpSourceTest::echoRequestTarget);
    server.start();
    String base = "http://127.0.0.1:" + server.getAddress().getPort();
    try (var http = new HttpSource(new ObjectMapper(), "", "127.0.0.1")) {
      var encoded = config(base + "/cities/Z%C3%BCrich?q=%E6%9D%B1%E4%BA%AC", 1000);
      assertThat(fetch(http, encoded, Map.of()))
          .isEqualTo(Map.of("path", "/cities/Z%C3%BCrich", "query", "q=%E6%9D%B1%E4%BA%AC"));
      assertThat(fetch(http, encoded, Map.of("city", "東京")))
          .isEqualTo(
              Map.of(
                  "path",
                  "/cities/Z%C3%BCrich",
                  "query",
                  "q=%E6%9D%B1%E4%BA%AC&city=%E6%9D%B1%E4%BA%AC"));
      // The same characters written raw were sent as Latin-1 bytes and '?' before.
      var raw = config(base + "/cities/Zürich?q=東京", 1000);
      assertThatThrownBy(() -> fetch(http, raw, Map.of()))
          .hasMessage(
              "Percent-encode non-ASCII characters in the URL as UTF-8 (Zürich → Z%C3%BCrich)");
    } finally {
      server.stop(0);
    }
  }

  @Test
  void numberParametersUsePlainDecimalTextLikeToString() throws Exception {
    var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext("/price", HttpSourceTest::echoQuery);
    server.start();
    String base = "http://127.0.0.1:" + server.getAddress().getPort() + "/price";
    var inputs = new LinkedHashMap<String, Object>();
    inputs.put("amount", new BigDecimal("1.2E+3"));
    inputs.put("rounded", new BigDecimal("2E+1"));
    inputs.put("tiny", new BigDecimal("1E-7"));
    inputs.put("scaled", new BigDecimal("20.0"));
    inputs.put("flag", true);
    try (var http = new HttpSource(new ObjectMapper(), "", "127.0.0.1")) {
      assertThat(query(fetch(http, config(base, 1000), inputs)))
          .isEqualTo("amount=1200&rounded=20&tiny=0.0000001&scaled=20.0&flag=true");
    } finally {
      server.stop(0);
    }
  }

  @Test
  void responseNumbersOutsideTheValueBoundsAreRejected() throws Exception {
    var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext(
        "/integer", exchange -> respond(exchange, 200, "{\"count\":" + "9".repeat(150) + "}"));
    server.createContext("/zero", exchange -> respond(exchange, 200, "{\"count\":0e-1500}"));
    server.start();
    String base = "http://127.0.0.1:" + server.getAddress().getPort();
    // The application's mapper reads JSON decimals as BigDecimal (application.yaml).
    var responses =
        JsonMapper.builder().enable(DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS).build();
    try (var http = new HttpSource(responses, "", "127.0.0.1")) {
      for (String path : List.of("/integer", "/zero"))
        assertThatThrownBy(() -> fetch(http, config(base + path, 1000), Map.of()))
            .as(path)
            .hasMessage("Number exceeds supported precision or magnitude");
    } finally {
      server.stop(0);
    }
  }

  @Test
  void reusesConnectionsWithoutReplayingCookiesOrAuthenticationChallenges() throws Exception {
    var requests = new java.util.concurrent.atomic.AtomicInteger();
    var ports = new CopyOnWriteArrayList<Integer>();
    var cookies = new CopyOnWriteArrayList<String>();
    var authorization = new CopyOnWriteArrayList<String>();
    var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext(
        "/",
        exchange -> {
          requests.incrementAndGet();
          ports.add(exchange.getRemoteAddress().getPort());
          cookies.add(Objects.toString(exchange.getRequestHeaders().getFirst("Cookie"), ""));
          authorization.add(
              Objects.toString(exchange.getRequestHeaders().getFirst("Authorization"), ""));
          exchange.getResponseHeaders().add("Set-Cookie", "private-session=first; Path=/");
          if (exchange.getRequestURI().getPath().equals("/authenticate")) {
            exchange.getResponseHeaders().add("WWW-Authenticate", "Basic realm=private");
            exchange.sendResponseHeaders(401, -1);
          } else {
            exchange.sendResponseHeaders(200, 2);
            exchange.getResponseBody().write("{}".getBytes(StandardCharsets.UTF_8));
          }
          exchange.close();
        });
    server.start();
    String base = "http://127.0.0.1:" + server.getAddress().getPort();
    try (var http = new HttpSource(new ObjectMapper(), "127.0.0.1", "127.0.0.1")) {
      fetch(http, config(base, 1000), Map.of());
      fetch(http, config(base, 1000), Map.of());
      assertThat(ports.get(1)).isEqualTo(ports.getFirst());
      assertThatThrownBy(() -> fetch(http, config(base + "/authenticate", 1000), Map.of()))
          .hasMessageContaining("401");
      fetch(http, config(base, 1000), Map.of());
      assertThat(requests).hasValue(4);
      assertThat(cookies).containsOnly("");
      assertThat(authorization).containsOnly("");
    } finally {
      server.stop(0);
    }
  }

  @Test
  void sequentialReadsShareAnOverallDeadlineAndCancelTheActiveRequest() throws Exception {
    var slowStarted = new CountDownLatch(1);
    var releaseSlow = new CountDownLatch(1);
    var requests = new java.util.concurrent.atomic.AtomicInteger();
    var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.setExecutor(Executors.newVirtualThreadPerTaskExecutor());
    server.createContext(
        "/",
        exchange -> {
          requests.incrementAndGet();
          try {
            if (exchange.getRequestURI().getPath().equals("/slow")) {
              slowStarted.countDown();
              releaseSlow.await(3, TimeUnit.SECONDS);
            } else {
              Thread.sleep(200);
            }
            exchange.sendResponseHeaders(200, 2);
            exchange.getResponseBody().write("{}".getBytes(StandardCharsets.UTF_8));
          } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
          } finally {
            exchange.close();
          }
        });
    server.start();
    String base = "http://127.0.0.1:" + server.getAddress().getPort();
    try (var http = new HttpSource(new ObjectMapper(), "127.0.0.1", "127.0.0.1")) {
      var deadline = ExecutionDeadline.start(700);
      long before = System.nanoTime();
      http.fetch(config(base, 2000), Map.of(), deadline);
      assertThat(deadline.remainingMillis()).isLessThan(600);
      assertThatThrownBy(() -> http.fetch(config(base + "/slow", 2000), Map.of(), deadline))
          .isInstanceOfSatisfying(
              ArcException.class, error -> assertThat(error.status()).isEqualTo(504))
          .hasMessage("Rule execution deadline exceeded");
      assertThat(slowStarted.getCount()).isZero();
      assertThat(TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - before)).isLessThan(1500);
      assertThatThrownBy(() -> http.fetch(config(base, 2000), Map.of(), deadline))
          .hasMessage("Rule execution deadline exceeded");
      assertThat(requests).hasValue(2);
    } finally {
      releaseSlow.countDown();
      server.stop(0);
      ((ExecutorService) server.getExecutor()).close();
    }
  }

  @Test
  void pooledRequestsKeepBodyLimitsAndRejectCompressedOrTrailingJson() throws Exception {
    byte[] large = new byte[1_048_577];
    Arrays.fill(large, (byte) ' ');
    var compressed = new java.io.ByteArrayOutputStream();
    try (var gzip = new java.util.zip.GZIPOutputStream(compressed)) {
      gzip.write("{}".getBytes(StandardCharsets.UTF_8));
    }
    var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext(
        "/",
        exchange -> {
          String path = exchange.getRequestURI().getPath();
          byte[] body =
              path.equals("/large")
                  ? large
                  : path.equals("/gzip")
                      ? compressed.toByteArray()
                      : "{} {}".getBytes(StandardCharsets.UTF_8);
          if (path.equals("/gzip")) exchange.getResponseHeaders().add("Content-Encoding", "gzip");
          exchange.sendResponseHeaders(200, body.length);
          try (var response = exchange.getResponseBody()) {
            response.write(body);
          }
        });
    server.start();
    String base = "http://127.0.0.1:" + server.getAddress().getPort();
    try (var http = new HttpSource(new ObjectMapper(), "127.0.0.1", "127.0.0.1")) {
      assertThatThrownBy(() -> fetch(http, config(base + "/large", 1000), Map.of()))
          .hasMessageContaining("exceeds 1 MiB");
      assertThatThrownBy(() -> fetch(http, config(base + "/gzip", 1000), Map.of()))
          .hasMessageContaining("valid JSON");
      assertThatThrownBy(() -> fetch(http, config(base + "/trailing", 1000), Map.of()))
          .hasMessageContaining("valid JSON");
    } finally {
      server.stop(0);
    }
  }

  @Test
  void rejectedResponsesAbortTheConnectionInsteadOfDownloadingTheRestOfTheBody() throws Exception {
    var endless = new StreamedBody(-1);
    var huge = new StreamedBody(256L * MIB);
    var failing = new StreamedBody(256L * MIB);
    var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.setExecutor(Executors.newVirtualThreadPerTaskExecutor());
    server.createContext("/endless", exchange -> endless.send(exchange, 200));
    server.createContext("/huge", exchange -> huge.send(exchange, 200));
    server.createContext("/failing", exchange -> failing.send(exchange, 500));
    server.createContext("/ok", exchange -> respond(exchange, 200, "{\"ok\":true}"));
    server.start();
    String base = "http://127.0.0.1:" + server.getAddress().getPort();
    try (var http = new HttpSource(new ObjectMapper(), "", "127.0.0.1")) {
      for (var request :
          List.of(
              Map.entry("/endless", "exceeds 1 MiB"),
              Map.entry("/huge", "exceeds 1 MiB"),
              Map.entry("/failing", "returned status 500"))) {
        long started = System.nanoTime();
        assertThatThrownBy(() -> fetch(http, config(base + request.getKey(), 10_000), Map.of()))
            .as(request.getKey())
            .hasMessageContaining(request.getValue());
        assertThat(TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started))
            .as(request.getKey())
            .isLessThan(3_000);
      }
      for (var body : List.of(endless, huge, failing))
        assertThat(body.bytesSentWhenStopped()).isLessThan(64L * MIB);
      assertThat(fetch(http, config(base + "/ok", 1000), Map.of())).isEqualTo(Map.of("ok", true));
    } finally {
      server.stop(0);
      ((ExecutorService) server.getExecutor()).close();
    }
  }

  /** Streams spaces until the client disconnects or the declared length (or forever, if -1). */
  private static final class StreamedBody {
    private final long length;
    private final AtomicLong sent = new AtomicLong();
    private final CountDownLatch stopped = new CountDownLatch(1);

    StreamedBody(long length) {
      this.length = length;
    }

    void send(HttpExchange exchange, int status) {
      byte[] block = new byte[64 * 1024];
      Arrays.fill(block, (byte) ' ');
      try (exchange) {
        exchange.sendResponseHeaders(status, length < 0 ? 0 : length);
        var body = exchange.getResponseBody();
        while (length < 0 || sent.get() < length) {
          body.write(block);
          sent.addAndGet(block.length);
        }
      } catch (IOException disconnected) {
        // The client closed the connection, which is the expected way for this body to end.
      } finally {
        stopped.countDown();
      }
    }

    long bytesSentWhenStopped() throws InterruptedException {
      assertThat(stopped.await(10, TimeUnit.SECONDS)).as("server stopped sending").isTrue();
      return sent.get();
    }
  }

  private static void echoQuery(HttpExchange exchange) throws IOException {
    String raw = exchange.getRequestURI().getRawQuery();
    respond(
        exchange,
        200,
        new ObjectMapper().writeValueAsString(Map.of("query", raw == null ? "<none>" : raw)));
  }

  /** The request target as received, before any decoding. */
  private static void echoRequestTarget(HttpExchange exchange) throws IOException {
    URI target = exchange.getRequestURI();
    respond(
        exchange,
        200,
        new ObjectMapper()
            .writeValueAsString(
                Map.of(
                    "path",
                    target.getRawPath(),
                    "query",
                    target.getRawQuery() == null ? "<none>" : target.getRawQuery())));
  }

  /**
   * A raw HTTP/1.1 server on 127.0.0.1 that answers every request with {@code head}, then {@code
   * {}}. HttpServer cannot write malformed or oversized heads.
   */
  private static ServerSocket rawServer(String head) throws IOException {
    var server = new ServerSocket(0, 50, InetAddress.getLoopbackAddress());
    Thread.ofVirtual()
        .start(
            () -> {
              while (!server.isClosed()) {
                try (Socket client = server.accept()) {
                  var request = client.getInputStream();
                  int last = 0, matched = 0;
                  while (matched < 4 && (last = request.read()) != -1)
                    matched = (last == (matched % 2 == 0 ? '\r' : '\n')) ? matched + 1 : 0;
                  var response = client.getOutputStream();
                  response.write(head.getBytes(StandardCharsets.ISO_8859_1));
                  response.write(
                      "Content-Length: 2\r\n\r\n{}".getBytes(StandardCharsets.ISO_8859_1));
                  response.flush();
                } catch (IOException closed) {
                  // The client gave up on the response, or the server is closing.
                }
              }
            });
    return server;
  }

  @Test
  void responseHeadsAreBoundedLikeBodies() throws Exception {
    // HttpCore's default Http1Config has no line or header-count limit: a source server sending an
    // endless header line was buffered until the heap ran out (OutOfMemoryError after 188 ms at
    // -Xmx256m), while the body had a 1 MiB limit.
    String longLine = "HTTP/1.1 200 OK\r\nX-Long: " + "a".repeat(8 * MIB) + "\r\n";
    var manyHeaders = new StringBuilder("HTTP/1.1 200 OK\r\n");
    for (int header = 0; header < 1_000; header++)
      manyHeaders.append("X-").append(header).append(": v\r\n");
    for (String head : List.of(longLine, manyHeaders.toString())) {
      try (var server = rawServer(head);
          var http = new HttpSource(new ObjectMapper(), "", "127.0.0.1")) {
        var definition = config("http://127.0.0.1:" + server.getLocalPort(), 5_000);
        assertThatThrownBy(() -> fetch(http, definition, Map.of()))
            .isInstanceOf(ArcException.class)
            .hasMessageStartingWith("HTTP source failed");
      }
    }
    // An ordinary head still works.
    try (var server = rawServer("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n");
        var http = new HttpSource(new ObjectMapper(), "", "127.0.0.1")) {
      assertThat(fetch(http, config("http://127.0.0.1:" + server.getLocalPort(), 5_000), Map.of()))
          .isEqualTo(Map.of());
    }
  }

  @Test
  void aHostWithSeveralStalledAddressesStopsAtTheCallTimeout() throws Exception {
    // The per-call cancellation closed only the socket open at that moment; HttpClient then tried
    // every other resolved address with a fresh connect and TLS timeout, so one read took
    // addresses x timeoutMs (a source Test answered after 70 s with a 10 s timeout and 8
    // addresses).
    var stalled = new ServerSocket(0, 50, InetAddress.getLoopbackAddress());
    var held = new CopyOnWriteArrayList<Socket>();
    Thread.ofVirtual()
        .start(
            () -> {
              try {
                while (true) held.add(stalled.accept()); // never answers the TLS handshake
              } catch (IOException closed) {
                // The test is over.
              }
            });
    var loopback = InetAddress.getLoopbackAddress();
    var policy =
        HttpDestinationPolicyTest.answering(
            "stalled.example", loopback, loopback, loopback, loopback, loopback);
    try (var http = new HttpSource(new ObjectMapper(), policy)) {
      var definition = config("https://stalled.example:" + stalled.getLocalPort() + "/", 300);
      long start = System.nanoTime();
      assertThatThrownBy(() -> fetch(http, definition, Map.of()))
          .isInstanceOf(ArcException.class)
          .hasMessageStartingWith("HTTP source failed");
      long elapsedMs = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start);
      assertThat(elapsedMs).as("five stalled addresses with a 300 ms timeout").isLessThan(900);
    } finally {
      stalled.close();
      for (Socket socket : held) socket.close();
    }
    // An address that refuses at once still fails over to the next one while time remains.
    var server = HttpServer.create(new InetSocketAddress(loopback, 0), 0);
    server.createContext("/", exchange -> respond(exchange, 200, "{\"ok\":true}"));
    server.start();
    var refusingFirst =
        HttpDestinationPolicyTest.answering(
            "two.example", InetAddress.getByName("::1"), InetAddress.getByName("127.0.0.1"));
    try (var http = new HttpSource(new ObjectMapper(), refusingFirst)) {
      var definition = config("http://two.example:" + server.getAddress().getPort() + "/", 2_000);
      assertThat(fetch(http, definition, Map.of())).isEqualTo(Map.of("ok", true));
    } finally {
      server.stop(0);
    }
  }

  private static void respond(HttpExchange exchange, int status, String json) throws IOException {
    byte[] body = json.getBytes(StandardCharsets.UTF_8);
    exchange.sendResponseHeaders(status, body.length);
    try (var response = exchange.getResponseBody()) {
      response.write(body);
    }
  }

  private static Object query(Object response) {
    return ((Map<?, ?>) response).get("query");
  }
}
