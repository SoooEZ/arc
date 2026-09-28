package dev.arc.source.http;

import dev.arc.error.ArcException;
import dev.arc.model.SourceDefinition;
import java.net.InetAddress;
import java.net.URI;
import java.net.UnknownHostException;
import java.util.HashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;
import org.apache.hc.client5.http.DnsResolver;

/**
 * Validates configured destinations without IO, then checks addresses when the HTTP client resolves
 * its connection. A host allowlist never implicitly grants access to private addresses.
 */
final class HttpDestinationPolicy implements DnsResolver {
  private static final int MAX_URL_CHARACTERS = 2_000;
  private static final int MAX_SECRET_HEADERS = 10;

  /** Longest secret header name, and longest environment alias after {@code ARC_SECRET_}. */
  private static final int MAX_SECRET_NAME_CHARACTERS = 64;

  private static final Pattern SECRET_HEADER_NAME =
      Pattern.compile("[A-Za-z][A-Za-z0-9-]{0," + (MAX_SECRET_NAME_CHARACTERS - 1) + "}");
  private static final Pattern SECRET_ALIAS =
      Pattern.compile("[A-Z][A-Z0-9_]{0," + (MAX_SECRET_NAME_CHARACTERS - 1) + "}");
  private static final Set<String> FORBIDDEN_SECRET_HEADERS =
      Set.of("host", "content-length", "connection", "transfer-encoding");

  /** Resolves every address of a host name; production uses the JVM resolver. */
  @FunctionalInterface
  interface HostLookup {
    InetAddress[] addresses(String host) throws UnknownHostException;
  }

  private final Set<String> allowedHosts;
  private final Set<String> privateHosts;
  private final HostLookup lookup;

  HttpDestinationPolicy(String allowedHosts, String privateHosts) {
    this(allowedHosts, privateHosts, InetAddress::getAllByName);
  }

  HttpDestinationPolicy(String allowedHosts, String privateHosts, HostLookup lookup) {
    this.allowedHosts = hosts(allowedHosts);
    this.privateHosts = hosts(privateHosts);
    this.lookup = lookup;
  }

  URI validate(SourceDefinition definition) {
    URI uri;
    try {
      uri = URI.create(definition.url());
    } catch (Exception error) {
      throw ArcException.invalid("Provide an absolute HTTP(S) URL");
    }
    String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase(Locale.ROOT);
    if (!Set.of("http", "https").contains(uri.getScheme() == null ? "" : uri.getScheme())
        || host.isBlank()
        || uri.getUserInfo() != null
        || uri.getFragment() != null
        || uri.toString().length() > MAX_URL_CHARACTERS)
      throw ArcException.invalid("Use an HTTP(S) URL without credentials or fragment");
    if (!allowedHosts.isEmpty() && !allowedHosts.contains(host))
      throw ArcException.invalid("HTTP host is not in the configured allowlist");
    validateSecretHeaders(host, definition.secretHeaders());
    return uri;
  }

  private void validateSecretHeaders(String host, Map<String, String> headers) {
    if (headers == null) return;
    if (headers.size() > MAX_SECRET_HEADERS)
      throw ArcException.invalid("At most " + MAX_SECRET_HEADERS + " secret headers");
    for (var header : headers.entrySet()) {
      if (header.getKey() == null
          || !SECRET_HEADER_NAME.matcher(header.getKey()).matches()
          || FORBIDDEN_SECRET_HEADERS.contains(header.getKey().toLowerCase(Locale.ROOT))
          || header.getValue() == null
          || !SECRET_ALIAS.matcher(header.getValue()).matches())
        throw ArcException.invalid(
            "Secret headers map header names to uppercase environment aliases");
      if (!allowedHosts.contains(host))
        throw ArcException.invalid("Secret headers require an explicitly allowlisted HTTP host");
    }
  }

  /**
   * Blocks the whole host when any of its addresses is private or reserved (see {@link
   * BlockedAddresses}), unless the exact host name is a configured private-host exception.
   */
  @Override
  public InetAddress[] resolve(String host) throws UnknownHostException {
    InetAddress[] addresses = lookup.addresses(host);
    if (!privateHosts.contains(host.toLowerCase(Locale.ROOT)))
      for (InetAddress address : addresses)
        if (BlockedAddresses.contains(address))
          throw new UnknownHostException("Private or reserved HTTP destination is blocked");
    return addresses;
  }

  @Override
  public String resolveCanonicalHostname(String host) {
    return host;
  }

  private static Set<String> hosts(String csv) {
    var hosts = new HashSet<String>();
    for (String host : csv.split(","))
      if (!host.isBlank()) hosts.add(host.trim().toLowerCase(Locale.ROOT));
    return Set.copyOf(hosts);
  }
}
