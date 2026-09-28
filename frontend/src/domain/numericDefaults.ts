import {
  DecimalNumber,
  decimalTextParts,
  doubleKeepsDecimal,
  isDecimalNumber,
  sameJsonNumber,
  significantDigits,
  type DecimalParts,
} from "./json";
import { MAX_NUMBER_PRECISION, MAX_NUMBER_SCALE } from "./limits";

export type NumericDefault =
  | { valid: true; value: number | DecimalNumber | null }
  | { valid: false; error: string };

/**
 * The server's number limits (backend Limits.MAX_NUMBER_PRECISION and
 * MAX_NUMBER_SCALE), applied like its Expressions.bound: a number passes when
 * its digits and scale, as written or without trailing zeros, stay within both.
 * That is also why a stored draft keeps saving: PostgreSQL writes 1e100 out as
 * a 101-digit integer, which is 1e100 again without its trailing zeros.
 */
const maxPrecision = BigInt(MAX_NUMBER_PRECISION);
const maxScale = BigInt(MAX_NUMBER_SCALE);

const invalidNumber = "Enter a valid number before saving";
export const unsupportedNumber = `This number is too large or too precise. Use at most ${MAX_NUMBER_PRECISION} digits and ${MAX_NUMBER_SCALE} decimal places.`;

/** The JSON token for typed text, keeping its digits: "+007.50" -> "7.50", ".5e3" -> "0.5e3". */
function jsonNumberToken({
  negative,
  integer,
  fraction,
  exponent,
}: DecimalParts): string {
  const sign = negative ? "-" : "";
  const whole = integer.replace(/^0+(?=\d)/, "") || "0";
  const decimals = fraction ? `.${fraction}` : "";
  const power = exponent === 0n ? "" : `e${exponent}`;
  return `${sign}${whole}${decimals}${power}`;
}

function withinLimits(precision: bigint, scale: bigint): boolean {
  return precision <= maxPrecision && -maxScale <= scale && scale <= maxScale;
}

/** Whether the server accepts the JSON number `token`, before and after storing it. */
export function withinServerLimits(token: string): boolean {
  const parts = decimalTextParts(token);
  if (!parts) return false;
  const { digits, trailingZeros } = significantDigits(parts);
  // Precision counts the significant digits; scale counts decimal places.
  const precision = BigInt(digits.length);
  const scale = BigInt(parts.fraction.length) - parts.exponent;
  // A zero has no digits to strip, so its scale counts as written.
  if (!digits) return -maxScale <= scale && scale <= maxScale;
  const zeros = BigInt(trailingZeros);
  return (
    withinLimits(precision, scale) ||
    withinLimits(precision - zeros, scale - zeros)
  );
}

/**
 * Parses a NUMBER default. A value that a double carries exactly, decimal
 * places included, becomes a number, and any other value becomes a
 * DecimalNumber with the entered digits, so the draft never rounds or rescales
 * what the field shows. Values outside the server's number limits are rejected
 * before they reach the graph.
 */
export function parseNumericDefault(raw: string): NumericDefault {
  const text = raw.trim();
  if (!text) return { valid: true, value: null };
  const parts = decimalTextParts(text);
  if (!parts) return { valid: false, error: invalidNumber };
  const double = Number(text);
  // Compare what the server would read from the JSON, not binary floating-point precision.
  const value = doubleKeepsDecimal(text, double)
    ? double
    : new DecimalNumber(jsonNumberToken(parts));
  // The server checks the token that the save request carries.
  const savedToken = isDecimalNumber(value)
    ? value.text
    : JSON.stringify(value);
  if (!withinServerLimits(savedToken))
    return { valid: false, error: unsupportedNumber };
  return { valid: true, value };
}

/**
 * Whether two stored defaults hold the same number, or are both empty: for
 * example the field's own value and the saved draft that echoes it.
 */
export function sameNumericDefault(left: unknown, right: unknown): boolean {
  if (left == null || right == null) return left == null && right == null;
  return isJsonNumber(left) && isJsonNumber(right)
    ? sameJsonNumber(left, right)
    : Object.is(left, right);
}

const isJsonNumber = (value: unknown): value is number | DecimalNumber =>
  typeof value === "number" || isDecimalNumber(value);
