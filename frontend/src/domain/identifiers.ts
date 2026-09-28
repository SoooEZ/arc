const maxIdentifierLength = 64;
const identifier = /^[A-Za-z_][A-Za-z_0-9]{0,63}$/;
const identifierCharacters = /^[A-Za-z_0-9]*$/;
const reserved = new Set(["true", "false", "null", "and", "or"]);

export const identifierGuidance =
  "Use letters, digits, or _; start with a letter or _. No spaces, $ or @. Maximum 64 characters.";

export function identifierError(name: unknown): string | null {
  if (typeof name !== "string" || !identifier.test(name))
    return identifierGuidance;
  if (reserved.has(name.toLowerCase()))
    return `${name} is reserved. Choose another name.`;
  return null;
}

/** A complete name the server accepts for a parameter, result variable or Output field. */
export function isIdentifier(name: unknown): name is string {
  return identifierError(name) === null;
}

/**
 * Whether a field edit from `previous` to `next` is allowed. Empty names and
 * keyword prefixes stay editable; validation reports their completed values.
 * A name stored before identifiers were enforced may already be invalid, so an
 * edit is also allowed when it does not make the name worse: it may remove any
 * characters, and it may insert letters, digits and `_` as long as it neither
 * moves a digit to the front nor grows the name beyond 64 characters.
 */
export function acceptsIdentifierEdit(previous: string, next: string): boolean {
  if (next === "" || identifier.test(next)) return true;
  if (!identifierCharacters.test(insertedText(previous, next))) return false;
  if (next.length > maxIdentifierLength && next.length > previous.length)
    return false;
  return !startsWithDigit(next) || startsWithDigit(previous);
}

function startsWithDigit(name: string): boolean {
  return /^[0-9]/.test(name);
}

/** The text that replaced one changed range, e.g. "" for Backspace or the typed/pasted text. */
function insertedText(previous: string, next: string): string {
  const shorter = Math.min(previous.length, next.length);
  let prefix = 0;
  while (prefix < shorter && previous[prefix] === next[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < shorter - prefix &&
    previous[previous.length - 1 - suffix] === next[next.length - 1 - suffix]
  )
    suffix++;
  return next.slice(prefix, next.length - suffix);
}
