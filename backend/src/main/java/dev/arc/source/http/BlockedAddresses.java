package dev.arc.source.http;

import java.net.InetAddress;
import java.util.Arrays;
import java.util.List;

/**
 * Private, reserved and non-public IP destinations that an HTTP source may reach only through an
 * exact private-host exception. Addresses are classified by their raw bytes, never by {@link
 * InetAddress} predicates: a DNS answer such as {@code ::ffff:127.0.0.1} arrives as an IPv6 address
 * that the JDK does not call loopback, yet a dual-stack socket connects it to 127.0.0.1.
 *
 * <p>Ranges follow the IANA special-purpose registries
 * (https://www.iana.org/assignments/iana-ipv4-special-registry and
 * https://www.iana.org/assignments/iana-ipv6-special-registry). IPv6 destinations must be public
 * global unicast; IPv6 forms that carry traffic to an embedded IPv4 address are judged by that
 * address.
 */
final class BlockedAddresses {
  private static final List<Range> IPV4 =
      List.of(
          Range.parse("0.0.0.0/8"), // "this network"
          Range.parse("10.0.0.0/8"), // private
          Range.parse("100.64.0.0/10"), // shared address space (carrier-grade NAT)
          Range.parse("127.0.0.0/8"), // loopback
          Range.parse("169.254.0.0/16"), // link-local, including cloud metadata endpoints
          Range.parse("172.16.0.0/12"), // private
          Range.parse("192.0.0.0/24"), // IETF protocol assignments
          Range.parse("192.0.2.0/24"), // documentation
          Range.parse("192.168.0.0/16"), // private
          Range.parse("198.18.0.0/15"), // benchmarking
          Range.parse("198.51.100.0/24"), // documentation
          Range.parse("203.0.113.0/24"), // documentation
          Range.parse("224.0.0.0/3")); // multicast, reserved and broadcast

  /** IPv6 forms that deliver traffic to an IPv4 address embedded at a byte offset. */
  private static final List<Ipv4Embedding> IPV4_IN_IPV6 =
      List.of(
          new Ipv4Embedding(Range.parse("::ffff:0:0/96"), 12), // IPv4-mapped
          new Ipv4Embedding(Range.parse("::/96"), 12), // IPv4-compatible, including :: and ::1
          new Ipv4Embedding(Range.parse("64:ff9b::/96"), 12), // NAT64 well-known prefix
          new Ipv4Embedding(Range.parse("2002::/16"), 2)); // 6to4

  /**
   * Everything outside global unicast is blocked, including unique-local fc00::/7, link-local
   * fe80::/10, multicast ff00::/8 and local-use NAT64 64:ff9b:1::/48, whose embedded IPv4 position
   * depends on the operator's prefix length.
   */
  private static final Range GLOBAL_UNICAST = Range.parse("2000::/3");

  private static final List<Range> RESERVED_GLOBAL_UNICAST =
      List.of(
          Range.parse("2001::/32"), // Teredo: relays deliver to an obfuscated IPv4 client address
          Range.parse("2001:2::/48"), // benchmarking
          Range.parse("2001:db8::/32"), // documentation
          Range.parse("3fff::/20")); // documentation

  private BlockedAddresses() {}

  static boolean contains(InetAddress address) {
    return contains(address.getAddress());
  }

  private static boolean contains(byte[] address) {
    if (address.length == 4) return anyContains(IPV4, address);
    for (Ipv4Embedding embedding : IPV4_IN_IPV6)
      if (embedding.ipv6().contains(address)) return contains(embedding.ipv4(address));
    return !GLOBAL_UNICAST.contains(address) || anyContains(RESERVED_GLOBAL_UNICAST, address);
  }

  private static boolean anyContains(List<Range> ranges, byte[] address) {
    for (Range range : ranges) if (range.contains(address)) return true;
    return false;
  }

  private record Ipv4Embedding(Range ipv6, int offset) {
    byte[] ipv4(byte[] address) {
      return Arrays.copyOfRange(address, offset, offset + 4);
    }
  }

  /** A CIDR block such as {@code 10.0.0.0/8} or {@code fc00::/7}. */
  private static final class Range {
    private final byte[] prefix;
    private final int prefixBits;

    private Range(byte[] prefix, int prefixBits) {
      this.prefix = prefix;
      this.prefixBits = prefixBits;
    }

    static Range parse(String cidr) {
      int slash = cidr.indexOf('/');
      String address = cidr.substring(0, slash);
      byte[] prefix = address.contains(":") ? ipv6(address) : ipv4(address);
      int bits = Integer.parseInt(cidr.substring(slash + 1));
      if (bits < 0 || bits > prefix.length * 8) throw new IllegalArgumentException(cidr);
      return new Range(prefix, bits);
    }

    boolean contains(byte[] address) {
      if (address.length != prefix.length) return false;
      int wholeBytes = prefixBits / 8;
      for (int i = 0; i < wholeBytes; i++) if (address[i] != prefix[i]) return false;
      int partialBits = prefixBits % 8;
      if (partialBits == 0) return true;
      int mask = (0xff << (8 - partialBits)) & 0xff;
      return ((address[wholeBytes] ^ prefix[wholeBytes]) & mask) == 0;
    }

    private static byte[] ipv4(String text) {
      String[] octets = text.split("\\.", -1);
      if (octets.length != 4) throw new IllegalArgumentException(text);
      byte[] bytes = new byte[4];
      for (int i = 0; i < 4; i++) bytes[i] = (byte) number(octets[i], 10, 255);
      return bytes;
    }

    /** Hexadecimal groups with at most one "::" gap; embedded dotted IPv4 is not needed here. */
    private static byte[] ipv6(String text) {
      int gap = text.indexOf("::");
      List<String> head = groups(gap < 0 ? text : text.substring(0, gap));
      List<String> tail = gap < 0 ? List.of() : groups(text.substring(gap + 2));
      boolean complete = gap < 0 ? head.size() == 8 : head.size() + tail.size() < 8;
      if (!complete) throw new IllegalArgumentException(text);
      byte[] bytes = new byte[16];
      write(bytes, 0, head);
      write(bytes, 16 - 2 * tail.size(), tail);
      return bytes;
    }

    private static List<String> groups(String text) {
      return text.isEmpty() ? List.of() : List.of(text.split(":", -1));
    }

    private static void write(byte[] bytes, int offset, List<String> groups) {
      for (String group : groups) {
        int value = number(group, 16, 0xffff);
        bytes[offset++] = (byte) (value >> 8);
        bytes[offset++] = (byte) value;
      }
    }

    private static int number(String text, int radix, int maximum) {
      int value = Integer.parseInt(text, radix);
      if (value < 0 || value > maximum) throw new IllegalArgumentException(text);
      return value;
    }
  }
}
