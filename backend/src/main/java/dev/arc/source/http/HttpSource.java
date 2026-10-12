package dev.arc.source.http;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.ObjectReader;
import dev.arc.engine.BoundedJsonParser;
import dev.arc.engine.ExecutionDeadline;
import dev.arc.engine.Limits;
import dev.arc.engine.ValueBounds;
import dev.arc.engine.ValueText;
import dev.arc.error.ArcException;
import dev.arc.model.SourceDefinition;
import jakarta.annotation.PreDestroy;
import java.io.IOException;
import java.io.InterruptedIOException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.UnknownHostException;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import java.util.StringJoiner;
import java.util.concurrent.*;
import org.apache.hc.client5.http.DnsResolver;
import org.apache.hc.client5.http.SchemePortResolver;
import org.apache.hc.client5.http.classic.methods.HttpGet;
import org.apache.hc.client5.http.config.RequestConfig;
import org.apache.hc.client5.http.impl.classic.CloseableHttpClient;
import org.apache.hc.client5.http.impl.classic.HttpClients;
import org.apache.hc.client5.http.impl.io.DefaultHttpClientConnectionOperator;
import org.apache.hc.client5.http.impl.io.ManagedHttpClientConnectionFactory;
import org.apache.hc.client5.http.impl.io.PoolingHttpClientConnectionManagerBuilder;
import org.apache.hc.client5.http.io.HttpClientConnectionOperator;
import org.apache.hc.client5.http.io.ManagedHttpClientConnection;
import org.apache.hc.client5.http.protocol.HttpClientContext;
import org.apache.hc.client5.http.ssl.TlsSocketStrategy;
import org.apache.hc.core5.http.ClassicHttpResponse;
import org.apache.hc.core5.http.HttpHost;
import org.apache.hc.core5.http.URIScheme;
import org.apache.hc.core5.http.config.Http1Config;
import org.apache.hc.core5.http.config.RegistryBuilder;
import org.apache.hc.core5.http.io.SocketConfig;
import org.apache.hc.core5.http.protocol.HttpContext;
import org.apache.hc.core5.net.NamedEndpoint;
import org.apache.hc.core5.net.PercentCodec;
import org.apache.hc.core5.util.Timeout;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Bounded GET transport for HTTP sources: destination checks when a connection resolves, per-call
 * cancellation within the execution deadline, a bounded response head and a 1 MiB JSON body, and no
 * redirects, retries, cookies or authentication state.
 */
@Component
public class HttpSource implements AutoCloseable {
  /** Response bodies are read into memory, so larger ones are rejected. */
  private static final int MAX_RESPONSE_BYTES = 1024 * 1024;

  /**
   * The response head is bounded like the body: HttpCore's default has no line or header-count
   * limit, so a server could send one endless header line until the heap ran out.
   */
  private static final int MAX_HEADER_LINE_CHARACTERS = 16 * 1024;

  private static final int MAX_RESPONSE_HEADERS = 100;

  private static final int MAX_POOLED_CONNECTIONS = 100;
  private static final int MAX_POOLED_CONNECTIONS_PER_ROUTE = 20;

  /** The {@link System#nanoTime} by which a call must end, kept in its HttpClient context. */
  private static final String CALL_ENDS = "dev.arc.source.http.call-ends";

  private final ScheduledThreadPoolExecutor cancellations =
      new ScheduledThreadPoolExecutor(1, daemonThreads("arc-http-deadlines"));

  /**
   * Host lookups, one thread per lookup in flight: InetAddress.getAllByName cannot be interrupted,
   * so a lookup the call gave up on keeps its thread until the OS resolver answers, and must not
   * hold up the next call's lookup.
   */
  private final ExecutorService lookups =
      Executors.newCachedThreadPool(daemonThreads("arc-http-dns"));

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
        new DeadlineAwareConnections()
            .setDnsResolver(destinations)
            .setConnectionFactory(
                ManagedHttpClientConnectionFactory.builder()
                    .http1Config(
                        Http1Config.custom()
                            .setMaxLineLength(MAX_HEADER_LINE_CHARACTERS)
                            .setMaxHeaderCount(MAX_RESPONSE_HEADERS)
                            .build())
                    .build())
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
   * cancelled at the source timeout or the execution deadline, whichever comes first. The
   * definition's timeout must be set: {@link HttpSourceAdapter} refuses one without it.
   */
  public Object fetch(
      SourceDefinition definition, Map<String, Object> inputs, ExecutionDeadline deadline) {
    deadline.check();
    URI configured = validate(definition);
    long configuredTimeoutMs =
        Objects.requireNonNull(definition.timeoutMs(), "HTTP source timeout is not configured");
    try {
      var request = new HttpGet(withQueryParameters(configured, queryParameters(inputs)));
      request.setHeader("Accept", "application/json");
      if (definition.secretHeaders() != null)
        for (var header : definition.secretHeaders().entrySet())
          request.setHeader(header.getKey(), secret(header.getValue()));
      long timeoutMs = Math.min(configuredTimeoutMs, deadline.remainingMillis());
      request.setConfig(requestConfig(timeoutMs));
      var context = HttpClientContext.create();
      context.setAttribute(CALL_ENDS, System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(timeoutMs));
      var cancellation = cancellations.schedule(request::cancel, timeoutMs, TimeUnit.MILLISECONDS);
      try {
        Object value =
            client.execute(request, context, response -> readResponse(request, response));
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
    lookups.shutdownNow();
    client.close();
  }

  private static ThreadFactory daemonThreads(String name) {
    return runnable -> {
      Thread thread = new Thread(runnable, name);
      thread.setDaemon(true);
      return thread;
    };
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
    // The value bounds are enforced while the body is parsed, so an oversized document fails at
    // its first exceeded bound instead of being built in full first; the walk over the built value
    // remains the arbiter.
    try (var parser = responses.createParser(body)) {
      return ValueBounds.bounded(responses.readValue(new BoundedJsonParser(parser)));
    }
  }

  /**
   * Connections whose host lookup and connection attempts stay within the call's time. The lookup
   * runs through the destination policy on a lookup thread, and the call waits for it only as long
   * as it has time left: HttpClient resolved the host on the calling thread before any socket
   * existed, outside every timeout and the cancellation, so a stalled resolver held the evaluation
   * thread, and the request thread waiting on it, for the OS resolver's whole retry window. The
   * policy stays the client's own resolver as a second line. Each resolved address is then tried in
   * turn only while the call has time left: cancelling a call closes the socket open at that
   * moment, and HttpClient then tried every other address with a fresh connect and TLS timeout, so
   * one read lasted addresses x timeoutMs.
   */
  private final class DeadlineAwareConnections extends PoolingHttpClientConnectionManagerBuilder {
    @Override
    protected HttpClientConnectionOperator createConnectionOperator(
        SchemePortResolver schemePortResolver,
        DnsResolver dnsResolver,
        TlsSocketStrategy tlsSocketStrategy) {
      return new DefaultHttpClientConnectionOperator(
          schemePortResolver,
          dnsResolver,
          RegistryBuilder.<TlsSocketStrategy>create()
              .register(URIScheme.HTTPS.id, tlsSocketStrategy)
              .build()) {
        @Override
        public void connect(
            ManagedHttpClientConnection connection,
            HttpHost endpointHost,
            NamedEndpoint endpointName,
            InetSocketAddress localAddress,
            Timeout connectTimeout,
            SocketConfig socketConfig,
            Object attachment,
            HttpContext context)
            throws IOException {
          InetAddress[] addresses =
              endpointHost.getAddress() != null
                  ? new InetAddress[] {endpointHost.getAddress()}
                  : resolveWithin(
                      endpointHost.getHostName(), remainingNanos(context, connectTimeout));
          for (int index = 0; index < addresses.length; index++) {
            // A host that carries its address makes HttpClient skip its own lookup.
            var resolved =
                new HttpHost(
                    endpointHost.getSchemeName(),
                    addresses[index],
                    endpointHost.getHostName(),
                    endpointHost.getPort());
            try {
              super.connect(
                  connection,
                  resolved,
                  endpointName,
                  localAddress,
                  connectTimeout,
                  socketConfig,
                  attachment,
                  context);
              return;
            } catch (IOException failure) {
              // The next address, as HttpClient's own loop does; the last failure is the call's.
              if (index == addresses.length - 1) throw failure;
            }
          }
        }

        @Override
        protected void onBeforeSocketConnect(HttpContext context, HttpHost host) {
          if (context.getAttribute(CALL_ENDS) instanceof Long ends && System.nanoTime() - ends >= 0)
            throw new CallTimedOut();
        }
      };
    }
  }

  /**
   * The nanoseconds a call has left, from its context; a context without the mark gets the connect
   * timeout.
   */
  private static long remainingNanos(HttpContext context, Timeout connectTimeout) {
    if (context.getAttribute(CALL_ENDS) instanceof Long ends) return ends - System.nanoTime();
    return TimeUnit.MILLISECONDS.toNanos(connectTimeout.toMilliseconds());
  }

  /**
   * The host's addresses, checked by the destination policy, from a lookup thread the call waits
   * for only as long as it has time; a lookup still running afterwards is abandoned.
   */
  private InetAddress[] resolveWithin(String host, long remainingNanos) throws IOException {
    if (remainingNanos <= 0) throw new CallTimedOut();
    Future<InetAddress[]> lookup = lookups.submit(() -> destinations.resolve(host));
    try {
      return lookup.get(remainingNanos, TimeUnit.NANOSECONDS);
    } catch (TimeoutException late) {
      lookup.cancel(true);
      throw new UnknownHostException(host + ": DNS lookup did not answer within the call's time");
    } catch (ExecutionException failed) {
      if (failed.getCause() instanceof IOException refused) throw refused;
      if (failed.getCause() instanceof RuntimeException unexpected) throw unexpected;
      throw new IOException(failed.getCause());
    } catch (InterruptedException interrupted) {
      lookup.cancel(true);
      Thread.currentThread().interrupt();
      throw new InterruptedIOException(host + ": DNS lookup interrupted");
    }
  }

  /** Ends a connection attempt whose call has run out of time; the call reports a timeout. */
  private static final class CallTimedOut extends RuntimeException {
    CallTimedOut() {
      super("HTTP source call timed out", null, false, false);
    }
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
