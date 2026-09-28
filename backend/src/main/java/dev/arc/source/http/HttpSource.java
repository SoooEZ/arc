package dev.arc.source.http;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.ObjectReader;
import dev.arc.engine.ExecutionDeadline;
import dev.arc.engine.Limits;
import dev.arc.engine.ValueText;
import dev.arc.engine.expression.Expressions;
import dev.arc.error.ArcException;
import dev.arc.model.SourceDefinition;
import jakarta.annotation.PreDestroy;
import java.io.IOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.StringJoiner;
import java.util.concurrent.*;
import org.apache.hc.client5.http.classic.methods.HttpGet;
import org.apache.hc.client5.http.config.RequestConfig;
import org.apache.hc.client5.http.impl.classic.CloseableHttpClient;
import org.apache.hc.client5.http.impl.classic.HttpClients;
import org.apache.hc.client5.http.impl.io.PoolingHttpClientConnectionManagerBuilder;
import org.apache.hc.core5.http.ClassicHttpResponse;
import org.apache.hc.core5.net.PercentCodec;
import org.apache.hc.core5.util.Timeout;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Bounded GET transport for HTTP sources: destination checks when a connection resolves, per-call
 * cancellation within the execution deadline, a 1 MiB JSON body, and no redirects, retries, cookies
 * or authentication state.
 */
@Component
public class HttpSource implements AutoCloseable {
  /** Response bodies are read into memory, so larger ones are rejected. */
  private static final int MAX_RESPONSE_BYTES = 1024 * 1024;

  private static final int MAX_POOLED_CONNECTIONS = 100;
  private static final int MAX_POOLED_CONNECTIONS_PER_ROUTE = 20;

  private final ScheduledThreadPoolExecutor cancellations =
      new ScheduledThreadPoolExecutor(
          1,
          r -> {
            Thread t = new Thread(r, "arc-http-deadlines");
            t.setDaemon(true);
            return t;
          });
  private final ObjectReader responses;
  private final HttpDestinationPolicy destinations;
  private final CloseableHttpClient client;

  @Autowired
  public HttpSource(
      ObjectMapper json,
      @Value("${arc.http.allowed-hosts:}") String allowedHosts,
      @Value("${arc.http.private-hosts:}") String privateHosts) {
    this(json, new HttpDestinationPolicy(allowedHosts, privateHosts));
  }

  HttpSource(ObjectMapper json, HttpDestinationPolicy destinations) {
    this.responses =
        json.readerFor(Object.class).with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS);
    this.destinations = destinations;
    cancellations.setRemoveOnCancelPolicy(true);
    var manager =
        PoolingHttpClientConnectionManagerBuilder.create()
            .setDnsResolver(destinations)
            .setMaxConnTotal(MAX_POOLED_CONNECTIONS)
            .setMaxConnPerRoute(MAX_POOLED_CONNECTIONS_PER_ROUTE)
            .build();
    client =
        HttpClients.custom()
            .setConnectionManager(manager)
            .disableRedirectHandling()
            .disableAutomaticRetries()
            .disableContentCompression()
            .disableCookieManagement()
            .disableAuthCaching()
            .disableConnectionState()
            .build();
  }

  public URI validate(SourceDefinition definition) {
    return destinations.validate(definition);
  }

  /**
   * GETs the configured URL with the non-null inputs appended as query parameters. The call is
   * cancelled at the source timeout or the execution deadline, whichever comes first.
   */
  public Object fetch(
      SourceDefinition definition, Map<String, Object> inputs, ExecutionDeadline deadline) {
    deadline.check();
    URI configured = validate(definition);
    try {
      var request = new HttpGet(withQueryParameters(configured, queryParameters(inputs)));
      request.setHeader("Accept", "application/json");
      if (definition.secretHeaders() != null)
        for (var header : definition.secretHeaders().entrySet())
          request.setHeader(header.getKey(), secret(header.getValue()));
      long timeoutMs = Math.min(definition.timeoutMs(), deadline.remainingMillis());
      request.setConfig(requestConfig(timeoutMs));
      var cancellation = cancellations.schedule(request::cancel, timeoutMs, TimeUnit.MILLISECONDS);
      try {
        Object value = client.execute(request, response -> readResponse(request, response));
        deadline.check();
        return value;
      } finally {
        cancellation.cancel(false);
      }
    } catch (ArcException e) {
      deadline.check();
      throw e;
    } catch (Exception e) {
      deadline.check();
      throw ArcException.invalid(
          "HTTP source failed: destination unavailable, blocked, timed out, or response is not"
              + " valid JSON");
    }
  }

  @Override
  @PreDestroy
  public void close() throws IOException {
    cancellations.shutdownNow();
    client.close();
  }

  /**
   * Numbers use plain decimal text, as {@code $TO_STRING} does; omitted (null) values are not sent.
   */
  private static Map<String, String> queryParameters(Map<String, Object> inputs) {
    var parameters = new LinkedHashMap<String, String>();
    for (var input : inputs.entrySet())
      if (input.getValue() != null)
        parameters.put(input.getKey(), ValueText.text(input.getValue()));
    return parameters;
  }

  /**
   * Keeps the configured query text byte for byte, so '+', ',', ';' and escapes reach the provider
   * as configured, and appends each parameter percent-encoded. A supplied parameter replaces the
   * configured pairs with the same decoded name.
   */
  private static URI withQueryParameters(URI configured, Map<String, String> parameters) {
    if (parameters.isEmpty()) return configured;
    var query = new StringJoiner("&");
    String configuredQuery = configured.getRawQuery();
    if (configuredQuery != null && !configuredQuery.isEmpty())
      for (String pair : configuredQuery.split("&", -1))
        if (!parameters.containsKey(decodedName(pair))) query.add(pair);
    parameters.forEach(
        (name, value) ->
            query.add(
                PercentCodec.encode(name, StandardCharsets.UTF_8)
                    + "="
                    + PercentCodec.encode(value, StandardCharsets.UTF_8)));
    String url = configured.toString();
    int queryStart = url.indexOf('?');
    return URI.create((queryStart < 0 ? url : url.substring(0, queryStart)) + "?" + query);
  }

  private static String decodedName(String pair) {
    int equals = pair.indexOf('=');
    return PercentCodec.decode(
        equals < 0 ? pair : pair.substring(0, equals), StandardCharsets.UTF_8);
  }

  private static String secret(String alias) {
    String secret = System.getenv("ARC_SECRET_" + alias);
    if (secret == null || secret.contains("\n") || secret.contains("\r"))
      throw ArcException.invalid("Configured source secret is unavailable");
    return secret;
  }

  private static RequestConfig requestConfig(long timeoutMs) {
    Timeout timeout = Timeout.ofMilliseconds(timeoutMs);
    return RequestConfig.custom()
        .setConnectTimeout(timeout)
        .setResponseTimeout(timeout)
        .setConnectionRequestTimeout(timeout)
        .setAuthenticationEnabled(false)
        .build();
  }

  private Object readResponse(HttpGet request, ClassicHttpResponse response) throws IOException {
    if (response.getCode() < 200 || response.getCode() >= 300)
      throw abort(request, "HTTP source returned status " + response.getCode());
    if (response.getEntity() == null)
      throw ArcException.invalid("HTTP source returned an empty body");
    byte[] body;
    try (var stream = response.getEntity().getContent()) {
      body = stream.readNBytes(MAX_RESPONSE_BYTES + 1);
      if (body.length > MAX_RESPONSE_BYTES)
        throw abort(
            request, "HTTP source response exceeds " + Limits.formatBytes(MAX_RESPONSE_BYTES));
    }
    return Expressions.bounded(responses.readValue(body));
  }

  /**
   * Closing a partly read response makes HttpClient download the rest of the body so that it can
   * reuse the connection; cancelling the request discards the connection instead.
   */
  private static ArcException abort(HttpGet request, String message) {
    request.cancel();
    return ArcException.invalid(message);
  }
}
