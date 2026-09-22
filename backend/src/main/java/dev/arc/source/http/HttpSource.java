package dev.arc.source.http;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.arc.engine.expression.Expressions;
import dev.arc.error.ArcException;
import dev.arc.model.SourceDefinition;
import java.io.IOException;
import java.net.InetAddress;
import java.net.URI;
import java.net.UnknownHostException;
import java.util.Map;
import java.util.concurrent.*;
import org.apache.hc.client5.http.classic.methods.HttpGet;
import org.apache.hc.client5.http.config.RequestConfig;
import org.apache.hc.client5.http.impl.classic.HttpClients;
import org.apache.hc.client5.http.impl.io.PoolingHttpClientConnectionManagerBuilder;
import org.apache.hc.core5.http.ClassicHttpResponse;
import org.apache.hc.core5.net.URIBuilder;
import org.apache.hc.core5.util.Timeout;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class HttpSource {
  private static final ScheduledExecutorService DEADLINES =
      Executors.newSingleThreadScheduledExecutor(
          r -> {
            Thread t = new Thread(r, "arc-http-deadlines");
            t.setDaemon(true);
            return t;
          });
  private final ObjectMapper json;
  private final HttpDestinationPolicy destinations;

  public HttpSource(
      ObjectMapper json,
      @Value("${arc.http.allowed-hosts:}") String allowed,
      @Value("${arc.http.private-hosts:}") String privateHosts) {
    this.json = json;
    this.destinations = new HttpDestinationPolicy(allowed, privateHosts);
  }

  public URI validate(SourceDefinition definition) {
    return destinations.validate(definition);
  }

  public InetAddress[] resolve(String host) throws UnknownHostException {
    return destinations.resolve(host);
  }

  public Object fetch(SourceDefinition c, Map<String, Object> inputs) {
    URI uri = validate(c);
    try {
      var builder = new URIBuilder(uri);
      for (var e : inputs.entrySet())
        if (e.getValue() != null) builder.setParameter(e.getKey(), e.getValue().toString());
      var request = new HttpGet(builder.build());
      request.setHeader("Accept", "application/json");
      if (c.secretHeaders() != null)
        for (var e : c.secretHeaders().entrySet()) {
          String secret = System.getenv("ARC_SECRET_" + e.getValue());
          if (secret == null || secret.contains("\n") || secret.contains("\r"))
            throw ArcException.invalid("Configured source secret is unavailable");
          request.setHeader(e.getKey(), secret);
        }
      var manager =
          PoolingHttpClientConnectionManagerBuilder.create().setDnsResolver(destinations).build();
      var config =
          RequestConfig.custom()
              .setConnectTimeout(Timeout.ofMilliseconds(c.timeoutMs()))
              .setResponseTimeout(Timeout.ofMilliseconds(c.timeoutMs()))
              .setConnectionRequestTimeout(Timeout.ofMilliseconds(c.timeoutMs()))
              .build();
      try (var client =
          HttpClients.custom()
              .setConnectionManager(manager)
              .setDefaultRequestConfig(config)
              .disableRedirectHandling()
              .disableAutomaticRetries()
              .disableContentCompression()
              .build()) {
        var deadline = DEADLINES.schedule(request::cancel, c.timeoutMs(), TimeUnit.MILLISECONDS);
        try {
          return client.execute(request, this::readResponse);
        } finally {
          deadline.cancel(false);
        }
      }
    } catch (ArcException e) {
      throw e;
    } catch (Exception e) {
      throw ArcException.invalid(
          "HTTP source failed: destination unavailable, blocked, timed out, or response is not"
              + " valid JSON");
    }
  }

  private Object readResponse(ClassicHttpResponse response) throws IOException {
    if (response.getCode() < 200 || response.getCode() >= 300)
      throw ArcException.invalid("HTTP source returned status " + response.getCode());
    if (response.getEntity() == null)
      throw ArcException.invalid("HTTP source returned an empty body");
    try (var stream = response.getEntity().getContent()) {
      byte[] bytes = stream.readNBytes(1_048_577);
      if (bytes.length > 1_048_576)
        throw ArcException.invalid("HTTP source response exceeds 1 MiB");
      Object value =
          json.readerFor(Object.class)
              .with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
              .readValue(bytes);
      return Expressions.bounded(value);
    }
  }
}
