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
import org.apache.hc.client5.http.DnsResolver;

/**
 * Validates configured destinations without IO, then checks addresses when the HTTP client resolves
 * its connection. A host allowlist never implicitly grants access to private addresses.
 */
final class HttpDestinationPolicy implements DnsResolver {
  private static final Set<String> FORBIDDEN_SECRET_HEADERS =
      Set.of("host", "content-length", "connection", "transfer-encoding");

  private final Set<String> allowedHosts;
  private final Set<String> privateHosts;

  HttpDestinationPolicy(String allowedHosts, String privateHosts) {
    this.allowedHosts = hosts(allowedHosts);
    this.privateHosts = hosts(privateHosts);
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
        || uri.toString().length() > 2000)
      throw ArcException.invalid("Use an HTTP(S) URL without credentials or fragment");
    if (!allowedHosts.isEmpty() && !allowedHosts.contains(host))
      throw ArcException.invalid("HTTP host is not in the configured allowlist");
    validateSecretHeaders(host, definition.secretHeaders());
    return uri;
  }

  private void validateSecretHeaders(String host, Map<String, String> headers) {
    if (headers == null) return;
    if (headers.size() > 10) throw ArcException.invalid("At most 10 secret headers");
    for (var header : headers.entrySet()) {
      if (!header.getKey().matches("[A-Za-z][A-Za-z0-9-]{0,63}")
          || FORBIDDEN_SECRET_HEADERS.contains(header.getKey().toLowerCase(Locale.ROOT))
          || header.getValue() == null
          || !header.getValue().matches("[A-Z][A-Z0-9_]{0,63}"))
        throw ArcException.invalid(
            "Secret headers map header names to uppercase environment aliases");
      if (!allowedHosts.contains(host))
        throw ArcException.invalid("Secret headers require an explicitly allowlisted HTTP host");
    }
  }

  @Override
  public InetAddress[] resolve(String host) throws UnknownHostException {
    InetAddress[] addresses = InetAddress.getAllByName(host);
    if (!privateHosts.contains(host.toLowerCase(Locale.ROOT)))
      for (InetAddress address : addresses)
        if (blocked(address))
          throw new UnknownHostException("Private or reserved HTTP destination is blocked");
    return addresses;
  }

  @Override
  public String resolveCanonicalHostname(String host) {
    return host;
  }

  private static boolean blocked(InetAddress address) {
    if (address.isAnyLocalAddress()
        || address.isLoopbackAddress()
        || address.isLinkLocalAddress()
        || address.isSiteLocalAddress()
        || address.isMulticastAddress()) return true;
    byte[] bytes = address.getAddress();
    if (bytes.length == 16) return blockedIpv6(bytes);
    return blockedIpv4(bytes);
  }

  private static boolean blockedIpv4(byte[] address) {
    int first = address[0] & 255;
    int second = address[1] & 255;
    int third = address[2] & 255;
    boolean sharedAddressSpace = first == 100 && second >= 64 && second <= 127;
    boolean protocolAssignments = first == 192 && second == 0 && third == 0;
    boolean benchmarking = first == 198 && (second == 18 || second == 19);
    // These documentation blocks are /24, not the entire surrounding /16.
    // https://www.iana.org/assignments/iana-ipv4-special-registry
    boolean documentation =
        first == 192 && second == 0 && third == 2
            || first == 198 && second == 51 && third == 100
            || first == 203 && second == 0 && third == 113;
    return first == 0
        || first >= 224
        || sharedAddressSpace
        || protocolAssignments
        || benchmarking
        || documentation;
  }

  private static boolean blockedIpv6(byte[] address) {
    int first = address[0] & 255;
    int second = address[1] & 255;
    boolean uniqueLocal = (first & 254) == 252;
    boolean documentation =
        first == 32 && second == 1 && (address[2] & 255) == 13 && (address[3] & 255) == 184;
    return uniqueLocal || documentation;
  }

  private static Set<String> hosts(String csv) {
    var hosts = new HashSet<String>();
    for (String host : csv.split(","))
      if (!host.isBlank()) hosts.add(host.trim().toLowerCase(Locale.ROOT));
    return Set.copyOf(hosts);
  }
}
