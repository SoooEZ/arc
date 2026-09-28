/**
 * Identifier generation for graph elements. crypto.randomUUID exists only in
 * secure contexts, so it throws on plain-HTTP origins such as
 * http://<host>:3080; crypto.getRandomValues is available on every origin.
 */

function hex(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += byte.toString(16).padStart(2, "0");
  return text;
}

/** An RFC 4122 version 4 UUID, e.g. "3b241101-e2bb-4255-8caf-4136c566a962". */
export function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // Version 4: random.
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // Variant 10xx: RFC 4122.
  const digits = hex(bytes);
  return [
    digits.slice(0, 8),
    digits.slice(8, 12),
    digits.slice(12, 16),
    digits.slice(16, 20),
    digits.slice(20),
  ].join("-");
}

/** `prefix` followed by `length` random lowercase hex digits, e.g. shortId("node-") -> "node-9f86d081". */
export function shortId(prefix: string, length = 8): string {
  if (!Number.isInteger(length) || length < 1)
    throw new RangeError(
      `An ID needs at least one random digit, not ${length}`,
    );
  const bytes = crypto.getRandomValues(new Uint8Array(Math.ceil(length / 2)));
  return prefix + hex(bytes).slice(0, length);
}

/** The first `${prefix}${n}` with n >= start that is not taken, e.g. uniqueName("result_", ["result_1"]) -> "result_2". */
export function uniqueName(
  prefix: string,
  taken: Iterable<string>,
  start = 1,
): string {
  const names = new Set(taken);
  let suffix = start;
  while (names.has(`${prefix}${suffix}`)) suffix++;
  return `${prefix}${suffix}`;
}
