package dev.arc.source.http;

import static org.assertj.core.api.Assertions.*;

import dev.arc.error.ArcException;
import dev.arc.model.SourceDefinition;
import java.net.UnknownHostException;
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
        "192.0.1.255",
        "192.0.3.0",
        "192.0.78.24",
        "192.2.0.1",
        "198.51.99.255",
        "198.51.101.0",
        "203.0.112.255",
        "203.0.114.0"
      })
  void allowsPublicAddressesOutsideTheExactReservedPrefixes(String address) throws Exception {
    assertThat(publicDestinations.resolve(address)).hasSize(1);
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "0.1.2.3",
        "10.0.0.1",
        "127.0.0.1",
        "169.254.169.254",
        "172.16.0.0",
        "172.31.255.255",
        "192.168.0.1",
        "100.64.0.0",
        "100.127.255.255",
        "198.18.0.0",
        "198.19.255.255",
        "224.0.0.1",
        "240.0.0.1",
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
        "1.1.1.1",
        "100.63.255.255",
        "100.128.0.0",
        "172.15.255.255",
        "172.32.0.0",
        "198.17.255.255",
        "198.20.0.0",
        "2001:db7:ffff::1",
        "2001:db9::1",
        "2606:4700:4700::1111",
        "::ffff:1.1.1.1"
      })
  void allowsPublicAddressesBesideOtherReservedRanges(String address) throws Exception {
    assertThat(publicDestinations.resolve(address)).hasSize(1);
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

  private SourceDefinition config(String url, Map<String, String> headers) {
    return new SourceDefinition("HTTP", url, List.of(), null, headers, 1000);
  }
}
