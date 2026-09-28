package dev.arc.source.http;

import static org.assertj.core.api.Assertions.*;

import dev.arc.error.ArcException;
import dev.arc.model.SourceDefinition;
import java.net.Inet4Address;
import java.net.Inet6Address;
import java.net.InetAddress;
import java.net.UnknownHostException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

class HttpDestinationPolicyTest {
  private final HttpDestinationPolicy publicDestinations = new HttpDestinationPolicy("", "");

  @ParameterizedTest
  @ValueSource(
      strings = {
        "192.0.0.0", "192.0.0.255", "192.0.2.0", "192.0.2.255",
        "198.51.100.0", "198.51.100.255", "203.0.113.0", "203.0.113.255"
      })
  void blocksEveryAddressInReservedProtocolAndDocumentationRanges(String address) {
    assertThatThrownBy(() -> publicDestinations.resolve(address))
        .isInstanceOf(UnknownHostException.class)
        .hasMessage("Private or reserved HTTP destination is blocked");
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "192.0.1.0",
        "192.0.1.1",
        "192.0.1.255",
        "192.0.3.0",
        "192.0.3.1",
        "192.0.78.24",
        "192.2.0.1",
        "198.51.99.1",
        "198.51.99.255",
        "198.51.101.0",
        "203.0.112.255",
        "203.0.114.0",
        "203.0.114.1"
      })
  void allowsPublicAddressesOutsideTheExactReservedPrefixes(String address) throws Exception {
    assertThat(publicDestinations.resolve(address)).hasSize(1);
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "0.1.2.3",
        "0.255.255.255",
        "10.0.0.1",
        "10.255.255.255",
        "127.0.0.1",
        "127.255.255.255",
        "169.254.0.0",
        "169.254.169.254",
        "169.254.255.255",
        "172.16.0.0",
        "172.31.255.255",
        "192.168.0.0",
        "192.168.0.1",
        "192.168.255.255",
        "100.64.0.0",
        "100.100.100.200",
        "100.127.255.255",
        "198.18.0.0",
        "198.19.255.255",
        "224.0.0.0",
        "224.0.0.1",
        "240.0.0.1",
        "255.255.255.255",
        "::",
        "::1",
        "::ffff:127.0.0.1",
        "fc00::1",
        "fdff::1",
        "fe80::1",
        "fec0::1",
        "ff02::1",
        "2001:db8::",
        "2001:db8:ffff:ffff:ffff:ffff:ffff:ffff"
      })
  void retainsPrivateSharedBenchmarkAndIpv6Restrictions(String address) {
    assertThatThrownBy(() -> publicDestinations.resolve(address))
        .isInstanceOf(UnknownHostException.class)
        .hasMessage("Private or reserved HTTP destination is blocked");
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "1.0.0.0",
        "1.1.1.1",
        "9.255.255.255",
        "11.0.0.0",
        "126.255.255.255",
        "128.0.0.0",
        "169.253.255.255",
        "169.255.0.0",
        "192.167.255.255",
        "192.169.0.0",
        "223.255.255.255",
        "100.63.255.255",
        "100.128.0.0",
        "172.15.255.255",
        "172.32.0.0",
        "198.17.255.255",
        "198.20.0.0",
        "2001:db7:ffff::1",
        "2001:db9::1",
        "2606:4700:4700::1111",
        "3fff:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
        "::ffff:1.1.1.1"
      })
  void allowsPublicAddressesBesideOtherReservedRanges(String address) throws Exception {
    assertThat(publicDestinations.resolve(address)).hasSize(1);
  }

  @Test
  void dnsAnswersForMappedLiteralsAreRealIpv6AddressesUnlikeTheParsedLiteral() throws Exception {
    assertThat(InetAddress.getByName("::ffff:127.0.0.1")).isInstanceOf(Inet4Address.class);
    InetAddress answer = ipv6("::ffff:127.0.0.1");
    assertThat(answer).isInstanceOf(Inet6Address.class);
    assertThat(answer.isLoopbackAddress()).isFalse();
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        // IPv4-mapped (::ffff:0:0/96): a dual-stack socket connects to the embedded IPv4 address.
        "::ffff:127.0.0.1",
        "::ffff:169.254.169.254",
        "::ffff:10.0.0.5",
        "::ffff:172.16.0.1",
        "::ffff:192.168.1.1",
        "::ffff:100.64.0.1",
        "::ffff:0.0.0.0",
        "::ffff:198.18.0.1",
        "::ffff:203.0.113.9",
        "::ffff:224.0.0.1",
        // IPv4-compatible (::/96), including the unspecified and loopback addresses.
        "::127.0.0.1",
        "::10.0.0.1",
        "::",
        "::1",
        // NAT64 well-known prefix (64:ff9b::/96).
        "64:ff9b::127.0.0.1",
        "64:ff9b::169.254.169.254",
        "64:ff9b::10.0.0.1",
        // 6to4 (2002::/16) with 127.0.0.1, 169.254.169.254 and 192.168.1.1.
        "2002:7f00:1::1",
        "2002:a9fe:a9fe::",
        "2002:c0a8:101:ffff:ffff:ffff:ffff:ffff",
        // Local-use NAT64 (64:ff9b:1::/48): the embedded position depends on the operator prefix.
        "64:ff9b:1::",
        "64:ff9b:1:ffff:ffff:ffff:ffff:ffff",
        "64:ff9b:1::808:808",
        // Teredo (2001::/32): relays deliver to an obfuscated IPv4 client address.
        "2001::",
        "2001:0:4136:e378:8000:63bf:3fff:fdd2",
        "2001:0:ffff:ffff:ffff:ffff:ffff:ffff"
      })
  void blocksIpv6AnswersThatDeliverToPrivateOrUnknownIpv4Destinations(String address)
      throws Exception {
    var policy = answering("", ipv6(address));
    assertThatThrownBy(() -> policy.resolve("attacker.example"))
        .isInstanceOf(UnknownHostException.class)
        .hasMessage("Private or reserved HTTP destination is blocked");
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "::ffff:1.1.1.1",
        "::8.8.8.8",
        "64:ff9b::1.1.1.1",
        "64:ff9b::203.0.114.1",
        "2002:808:808::1",
        "2002:c000:101::1",
        "2001:1::1",
        "2001:1:ffff:ffff:ffff:ffff:ffff:ffff",
        "2000::",
        "2000:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
        "2001:2:1::",
        "2003::1",
        "3ffe::1",
        "3fff:1000::",
        "2606:4700:4700::1111"
      })
  void allowsIpv6AnswersThatDeliverToPublicDestinations(String address) throws Exception {
    InetAddress answer = ipv6(address);
    assertThat(answering("", answer).resolve("public.example")).containsExactly(answer);
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "1fff:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
        "4000::",
        "4000::1",
        "5f00::1",
        "100::1",
        "::ffff:0:808:808",
        "::fffe:808:808",
        "64:ff9b::1:808:808",
        "2001:2::",
        "2001:2:0:ffff:ffff:ffff:ffff:ffff",
        "3fff::",
        "3fff:fff:ffff:ffff:ffff:ffff:ffff:ffff"
      })
  void blocksIpv6AddressesOutsidePublicGlobalUnicastSpace(String address) throws Exception {
    var policy = answering("", ipv6(address));
    assertThatThrownBy(() -> policy.resolve("reserved.example"))
        .isInstanceOf(UnknownHostException.class);
  }

  @Test
  void anyBlockedAnswerBlocksTheWholeHostUnlessItIsAnExactPrivateException() throws Exception {
    InetAddress[] answers = {InetAddress.getByName("1.1.1.1"), ipv6("::ffff:169.254.169.254")};
    assertThatThrownBy(() -> answering("", answers).resolve("mixed.example"))
        .isInstanceOf(UnknownHostException.class);
    assertThat(answering(" MIXED.example ", answers).resolve("mixed.example"))
        .containsExactly(answers);
    assertThatThrownBy(() -> answering("other.example", answers).resolve("mixed.example"))
        .isInstanceOf(UnknownHostException.class);
  }

  @Test
  void validatesUrlAndSecretMetadataWithoutResolvingTheHost() {
    var policy = new HttpDestinationPolicy(" api.example.invalid , OTHER.EXAMPLE.INVALID ", "");
    var definition = config("https://API.EXAMPLE.INVALID/data", Map.of("Authorization", "TOKEN"));
    assertThat(policy.validate(definition).getHost()).isEqualTo("API.EXAMPLE.INVALID");
    assertThat(policy.resolveCanonicalHostname("API.EXAMPLE.INVALID"))
        .isEqualTo("API.EXAMPLE.INVALID");
    assertThatThrownBy(() -> policy.validate(config("https://other.invalid/data", Map.of())))
        .hasMessage("HTTP host is not in the configured allowlist");
  }

  @Test
  void destinationAllowlistDoesNotGrantPrivateAddressAccess() {
    var policy = new HttpDestinationPolicy("127.0.0.1", "");
    assertThatCode(() -> policy.validate(config("http://127.0.0.1/data", Map.of())))
        .doesNotThrowAnyException();
    assertThatThrownBy(() -> policy.resolve("127.0.0.1")).isInstanceOf(UnknownHostException.class);
  }

  @Test
  void privateExceptionsAreExactAndDoNotGrantSecretOrOtherHostAccess() throws Exception {
    var policy = new HttpDestinationPolicy("", " 127.0.0.1, ::1 ");
    assertThat(policy.resolve("127.0.0.1")).hasSize(1);
    assertThat(policy.resolve("::1")).hasSize(1);
    assertThatThrownBy(() -> policy.resolve("127.0.0.2")).isInstanceOf(UnknownHostException.class);
    assertThatThrownBy(
            () ->
                policy.validate(config("http://127.0.0.1/data", Map.of("Authorization", "TOKEN"))))
        .hasMessage("Secret headers require an explicitly allowlisted HTTP host");
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "file:///etc/passwd",
        "/relative",
        "http://user:pass@example.com/",
        "https://example.com/#fragment"
      })
  void rejectsUnsupportedUrlForms(String url) {
    assertThatThrownBy(() -> publicDestinations.validate(config(url, Map.of())))
        .isInstanceOf(ArcException.class)
        .hasMessage("Use an HTTP(S) URL without credentials or fragment");
  }

  @Test
  void rejectsMalformedUrlsAndUnsafeSecretHeaders() {
    assertThatThrownBy(() -> publicDestinations.validate(config("http://bad host", Map.of())))
        .hasMessage("Provide an absolute HTTP(S) URL");
    var policy = new HttpDestinationPolicy("example.com", "");
    for (Map<String, String> headers :
        List.of(
            Map.of("Host", "TOKEN"),
            Map.of("Authorization", "not-an-alias"),
            Map.of("X\nHeader", "TOKEN")))
      assertThatThrownBy(() -> policy.validate(config("https://example.com/", headers)))
          .hasMessage("Secret headers map header names to uppercase environment aliases");
  }

  @Test
  void limitsUrlLengthSecretHeaderCountAndNameLengths() {
    var policy = new HttpDestinationPolicy("example.com", "");
    String base = "https://example.com/";
    assertThatCode(() -> policy.validate(config(base + "a".repeat(2_000 - base.length()), null)))
        .doesNotThrowAnyException();
    assertThatThrownBy(
            () -> policy.validate(config(base + "a".repeat(2_001 - base.length()), null)))
        .hasMessage("Use an HTTP(S) URL without credentials or fragment");

    var ten = new LinkedHashMap<String, String>();
    for (int i = 0; i < 10; i++) ten.put("X-Header-" + i, "TOKEN_" + i);
    assertThatCode(() -> policy.validate(config(base, ten))).doesNotThrowAnyException();
    var eleven = new LinkedHashMap<>(ten);
    eleven.put("X-Header-10", "TOKEN_10");
    assertThatThrownBy(() -> policy.validate(config(base, eleven)))
        .hasMessage("At most 10 secret headers");

    String longestName = "X" + "-".repeat(63);
    String longestAlias = "A" + "_".repeat(63);
    assertThatCode(() -> policy.validate(config(base, Map.of(longestName, longestAlias))))
        .doesNotThrowAnyException();
    for (Map<String, String> headers :
        List.of(Map.of(longestName + "x", "TOKEN"), Map.of("X-Token", longestAlias + "B")))
      assertThatThrownBy(() -> policy.validate(config(base, headers)))
          .hasMessage("Secret headers map header names to uppercase environment aliases");
  }

  private SourceDefinition config(String url, Map<String, String> headers) {
    return new SourceDefinition("HTTP", url, List.of(), null, headers, 1000);
  }

  /** A policy whose DNS lookup returns the given answers for every host name. */
  static HttpDestinationPolicy answering(String privateHosts, InetAddress... answers) {
    return new HttpDestinationPolicy("", privateHosts, host -> answers.clone());
  }

  /**
   * The address a DNS AAAA answer produces. The JDK parses a literal such as {@code
   * ::ffff:127.0.0.1} into an {@link Inet4Address}, but keeps resolver answers as {@link
   * Inet6Address}; a literal alone would hide IPv4-mapped destinations.
   */
  static InetAddress ipv6(String literal) throws UnknownHostException {
    byte[] bytes = InetAddress.getByName(literal).getAddress();
    if (bytes.length == 4) {
      byte[] mapped = new byte[16];
      mapped[10] = (byte) 0xff;
      mapped[11] = (byte) 0xff;
      System.arraycopy(bytes, 0, mapped, 12, 4);
      bytes = mapped;
    }
    return Inet6Address.getByAddress(literal, bytes, -1);
  }
}
