import { formatLimit } from "../../domain/limits";

/**
 * The server's HTTP source policy restated for the editor, so Save refuses what
 * the server would refuse, with the server's words and in its order, before
 * sending (lesson F34): the timeout range (HttpSourceAdapter) and the URL rules
 * (HttpDestinationPolicy). scripts/check_mirrors.test.mjs compares the
 * constants with the Java sources. The host allowlist and the address checks
 * need the server's configuration and stay there.
 */

/** The server accepts whole milliseconds in this range. */
const httpTimeoutLimits = { min: 100, max: 10_000 };
export const httpTimeoutGuidance = `Enter whole milliseconds from ${httpTimeoutLimits.min} to ${formatLimit(httpTimeoutLimits.max)}.`;

/** The timeout in `text`, or null when the server would reject it. */
export function parseHttpTimeout(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const milliseconds = Number(trimmed);
  return milliseconds >= httpTimeoutLimits.min &&
    milliseconds <= httpTimeoutLimits.max
    ? milliseconds
    : null;
}

/** The longest URL the server accepts. */
const MAX_URL_CHARACTERS = 2_000;
/** What java.net.URI refuses unescaped, which the server reads as no URL at all. */
const unescapedInUri = /[\s"<>\\^`{|}\u0000-\u001f\u007f]|%(?![0-9a-f]{2})/i;
/** Java's int, which bounds the port java.net.URI reads. */
const MAX_JAVA_INT = 2_147_483_647;
const ipv6Authority = /^\[([^\]]*)\](?::(\d*))?$/;
const serverAuthority = /^(\[[^\]]*\]|[^:[\]]*)(?::(\d*))?$/;
const hostnameLabel = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/;

/** A dotted quad of decimal octets up to 255, as java.net.URI reads one. */
function isIpv4Address(text: string): boolean {
  const octets = text.split(".");
  return (
    octets.length === 4 &&
    octets.every((octet) => /^\d+$/.test(octet) && Number(octet) <= 255)
  );
}

/**
 * Whether java.net.URI reads the text between brackets as an IPv6 address:
 * groups of up to four hexadecimal digits, one `::` at most, eight groups in
 * all (a trailing dotted quad counts as two) and an optional `%zone`.
 */
function isIpv6Address(text: string): boolean {
  const halves = text.split("%")[0].split("::");
  if (halves.length > 2) return false;
  const groups = halves.flatMap((half) => (half === "" ? [] : half.split(":")));
  let count = 0;
  for (const [index, group] of groups.entries()) {
    if (index === groups.length - 1 && group.includes(".")) {
      if (!isIpv4Address(group)) return false;
      count += 2;
    } else if (/^[0-9A-Fa-f]{1,4}$/.test(group)) count += 1;
    else return false;
  }
  return halves.length === 2 ? count <= 7 : count === 8;
}

/**
 * Whether java.net.URI reads a host from `authority`: host[:port] with a
 * dotted quad, a bracketed IPv6 literal or labels of letters, digits and
 * inner hyphens, the last of several starting with a letter, and a port of
 * digits within Java's int. Any other authority (an underscore, a label ending
 * in a hyphen, an empty label, a port that is not a number) is registry-based
 * for Java, which then reads no host and refuses the URL.
 */
function hasServerHost(authority: string): boolean {
  const parts = serverAuthority.exec(authority);
  if (!parts) return false;
  const [, host, port] = parts;
  if (port && Number(port) > MAX_JAVA_INT) return false;
  // A bracketed literal was checked as an IPv6 address before.
  if (host.startsWith("[")) return true;
  if (isIpv4Address(host)) return true;
  const labels = (host.endsWith(".") ? host.slice(0, -1) : host).split(".");
  return (
    labels.every((label) => hostnameLabel.test(label)) &&
    (labels.length === 1 || /^[A-Za-z]/.test(labels[labels.length - 1]))
  );
}

/**
 * Why the server would refuse an HTTP URL, in its order and with its words, or
 * null (HttpDestinationPolicy).
 */
export function httpUrlProblem(url: string): string | null {
  const parts = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)/i.exec(url);
  const scheme = parts?.[1] ?? "";
  const authority = parts?.[2] ?? "";
  const literal = /[[\]]/.test(authority)
    ? ipv6Authority.exec(authority)
    : undefined;
  // What java.net.URI cannot parse at all: an unescaped character, a bare
  // scheme:// or a malformed IPv6 literal.
  if (
    unescapedInUri.test(url) ||
    (parts !== null && authority === "" && url === parts[0]) ||
    (literal !== undefined && (!literal || !isIpv6Address(literal[1])))
  )
    return "Provide an absolute HTTP(S) URL.";
  // Text without a scheme parses as a relative URL, which this check names.
  if (
    !/^https?$/i.test(scheme) ||
    !hasServerHost(authority) ||
    authority.includes("@") ||
    url.includes("#") ||
    url.length > MAX_URL_CHARACTERS
  )
    return "Use an HTTP(S) URL without credentials or fragment.";
  if (/[^\x00-\x7f]/.test(url))
    return "Percent-encode non-ASCII characters as UTF-8 (Zürich → Z%C3%BCrich).";
  const port = /:(\d+)$/.exec(authority)?.[1];
  if (port !== undefined && (Number(port) < 1 || Number(port) > 65535))
    return "Use a port from 1 to 65535.";
  return null;
}

/** The most secret headers one source sends (HttpDestinationPolicy). */
export const MAX_SECRET_HEADERS = 10;
/** Longest secret header name, and longest alias after ARC_SECRET_. */
const MAX_SECRET_NAME_CHARACTERS = 64;
const secretHeaderName = new RegExp(
  `^[A-Za-z][A-Za-z0-9-]{0,${MAX_SECRET_NAME_CHARACTERS - 1}}$`,
);
const secretAlias = new RegExp(
  `^[A-Z][A-Z0-9_]{0,${MAX_SECRET_NAME_CHARACTERS - 1}}$`,
);
const forbiddenSecretHeaders = new Set([
  "host",
  "content-length",
  "connection",
  "transfer-encoding",
]);
const secretHeadersRule =
  "Secret headers map header names to uppercase environment aliases";

/** Whether the server sends a secret header of this name. */
export function isSecretHeaderName(name: string): boolean {
  return (
    secretHeaderName.test(name) &&
    !forbiddenSecretHeaders.has(name.toLowerCase())
  );
}

/** Whether an alias names an environment variable the server reads, ARC_SECRET_<alias>. */
export function isSecretAlias(alias: string): boolean {
  return secretAlias.test(alias);
}

/**
 * Why the server would refuse these secret headers, in its order and words, or
 * null. Whether the host is allowlisted for secrets is server configuration.
 */
export function secretHeadersProblem(
  headers: Record<string, string>,
): string | null {
  const entries = Object.entries(headers);
  if (entries.length > MAX_SECRET_HEADERS)
    return `At most ${MAX_SECRET_HEADERS} secret headers`;
  for (const [name, alias] of entries)
    if (!isSecretHeaderName(name) || !isSecretAlias(alias))
      return secretHeadersRule;
  return null;
}
