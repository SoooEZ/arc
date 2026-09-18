package dev.arc.source;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.arc.error.ArcException;
import dev.arc.model.SourceDefinition;
import java.net.*;
import java.util.*;
import java.util.concurrent.*;
import org.apache.hc.client5.http.DnsResolver;
import org.apache.hc.client5.http.classic.methods.HttpGet;
import org.apache.hc.client5.http.config.RequestConfig;
import org.apache.hc.client5.http.impl.classic.HttpClients;
import org.apache.hc.client5.http.impl.io.PoolingHttpClientConnectionManagerBuilder;
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
  private final Set<String> allowed, privateHosts;

  public HttpSource(
      ObjectMapper json,
      @Value("${arc.http.allowed-hosts:}") String allowed,
      @Value("${arc.http.private-hosts:}") String privateHosts) {
    this.json = json;
    this.allowed = hosts(allowed);
    this.privateHosts = hosts(privateHosts);
  }

  private static Set<String> hosts(String csv) {
    var set = new HashSet<String>();
    for (String h : csv.split(",")) if (!h.isBlank()) set.add(h.trim().toLowerCase(Locale.ROOT));
    return Set.copyOf(set);
  }

  public URI validate(SourceDefinition c) {
    URI uri;
    try {
      uri = URI.create(c.url());
    } catch (Exception e) {
      throw ArcException.invalid("Provide an absolute HTTP(S) URL");
    }
    String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase(Locale.ROOT);
    if (!Set.of("http", "https").contains(uri.getScheme() == null ? "" : uri.getScheme())
        || host.isBlank()
        || uri.getUserInfo() != null
        || uri.getFragment() != null
        || uri.toString().length() > 2000)
      throw ArcException.invalid("Use an HTTP(S) URL without credentials or fragment");
    if (!allowed.isEmpty() && !allowed.contains(host))
      throw ArcException.invalid("HTTP host is not in the configured allowlist");
    if (c.secretHeaders() != null) {
      if (c.secretHeaders().size() > 10) throw ArcException.invalid("At most 10 secret headers");
      for (var e : c.secretHeaders().entrySet()) {
        if (!e.getKey().matches("[A-Za-z][A-Za-z0-9-]{0,63}")
            || Set.of("host", "content-length", "connection", "transfer-encoding")
                .contains(e.getKey().toLowerCase(Locale.ROOT))
            || e.getValue() == null
            || !e.getValue().matches("[A-Z][A-Z0-9_]{0,63}"))
          throw ArcException.invalid(
              "Secret headers map header names to uppercase environment aliases");
        if (!allowed.contains(host))
          throw ArcException.invalid("Secret headers require an explicitly allowlisted HTTP host");
      }
    }
    return uri;
  }

  public InetAddress[] resolve(String host) throws UnknownHostException {
    InetAddress[] addresses = InetAddress.getAllByName(host);
    if (!privateHosts.contains(host.toLowerCase(Locale.ROOT)))
      for (InetAddress a : addresses)
        if (blocked(a))
          throw new UnknownHostException("Private or reserved HTTP destination is blocked");
    return addresses;
  }

  private static boolean blocked(InetAddress a) {
    if (a.isAnyLocalAddress()
        || a.isLoopbackAddress()
        || a.isLinkLocalAddress()
        || a.isSiteLocalAddress()
        || a.isMulticastAddress()) return true;
    byte[] b = a.getAddress();
    int x = b[0] & 255, y = b[1] & 255;
    if (b.length == 16)
      return (x & 254) == 252 || (x == 32 && y == 1 && (b[2] & 255) == 13 && (b[3] & 255) == 184);
    return x == 0
        || x >= 224
        || x == 100 && y >= 64 && y <= 127
        || x == 169 && y == 254
        || x == 192 && (y == 0 || y == 2)
        || x == 198 && (y == 18 || y == 19 || y == 51)
        || x == 203 && y == 0;
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
      DnsResolver dns =
          new DnsResolver() {
            public InetAddress[] resolve(String host) throws UnknownHostException {
              return HttpSource.this.resolve(host);
            }

            public String resolveCanonicalHostname(String host) throws UnknownHostException {
              return host;
            }
          };
      var manager = PoolingHttpClientConnectionManagerBuilder.create().setDnsResolver(dns).build();
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
          return client.execute(
              request,
              response -> {
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
                          .with(
                              com.fasterxml.jackson.databind.DeserializationFeature
                                  .FAIL_ON_TRAILING_TOKENS)
                          .readValue(bytes);
                  return ExpressionsBound.value(value);
                }
              });
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

  private static final class ExpressionsBound {
    static Object value(Object v) {
      return dev.arc.engine.Expressions.bounded(v);
    }
  }
}
