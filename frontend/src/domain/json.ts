/**
 * Lossless JSON for the HTTP boundary and editable JSON buffers.
 *
 * The backend keeps numbers as exact decimals with their decimal places (2.50
 * stays 2.50 in $CONCAT results), while a JavaScript double carries neither
 * every value nor any scale. parseJson keeps a number as a double only when
 * sending that double back as JSON gives the server the same number: the same
 * value with the same decimal places. Other numbers, such as 9007199254740993,
 * 0.12345678901234567890123, 1e400 and 2.50, become DecimalNumber values, and
 * stringifyJson writes their original tokens back. Only exponent spelling may
 * change: 1E2 becomes 100 and -0 becomes 0, as with JSON.parse and
 * JSON.stringify.
 *
 * Parsed objects follow JavaScript property order, as with JSON.parse:
 * integer-like keys first in ascending order, then the others as written.
 * Stored order is JSONB's, so displays show the browser's order, not the
 * server's.
 */

const numberGrammar = String.raw`-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?`;
const jsonNumberToken = new RegExp(`^${numberGrammar}$`);

/** A JSON number whose decimal value a double cannot carry, e.g. 9007199254740993 or 1e400. */
export class DecimalNumber {
  constructor(readonly text: string) {
    // stringifyJson writes this text into documents unquoted.
    if (!jsonNumberToken.test(text))
      throw new SyntaxError(`${JSON.stringify(text)} is not a JSON number`);
  }

  toString(): string {
    return this.text;
  }

  /**
   * Plain JSON.stringify (used for displays and snapshot keys) keeps the digits
   * where the engine has JSON.rawJSON and writes them as a string elsewhere.
   * Requests use stringifyJson, which always writes the number.
   */
  toJSON(): unknown {
    return "rawJSON" in JSON && typeof JSON.rawJSON === "function"
      ? JSON.rawJSON(this.text)
      : this.text;
  }
}

export function isDecimalNumber(value: unknown): value is DecimalNumber {
  return value instanceof DecimalNumber;
}

/** Whether `value` is a JSON object, as opposed to null, an array or a DecimalNumber. */
export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !isDecimalNumber(value)
  );
}

/**
 * Decimal text as users type it: "+1", ".5", "5." and "1e3" are numbers; "1e",
 * "." and "0x10" are not. JSON number tokens are a subset. This is the one
 * grammar for typed decimals; numeric defaults and the codec both read it.
 */
const decimalGrammar = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/;

export interface DecimalParts {
  negative: boolean;
  /** The digits before the point, as written (leading zeros included). */
  integer: string;
  /** The digits after the point, as written (trailing zeros included). */
  fraction: string;
  exponent: bigint;
}

/** The parts of typed decimal text, or null when it is not a number. */
export function decimalTextParts(text: string): DecimalParts | null {
  const parts = decimalGrammar.exec(text);
  if (!parts) return null;
  const [, sign, integer, fraction = "", exponent = "0"] = parts;
  if (!integer && !fraction) return null;
  return {
    negative: sign === "-",
    integer,
    fraction,
    exponent: BigInt(exponent),
  };
}

/**
 * The written digits without leading zeros, and how many of them are trailing
 * zeros: "012.50" -> "1250" with one trailing zero. A zero has no digits.
 */
export function significantDigits({ integer, fraction }: DecimalParts): {
  digits: string;
  trailingZeros: number;
} {
  const digits = (integer + fraction).replace(/^0+/, "");
  return {
    digits,
    trailingZeros: digits.length - digits.replace(/0+$/, "").length,
  };
}

interface Decimal {
  /** Coefficient/exponent form of the value, e.g. "-012.50e1" -> "-125e0"; "0" for every zero. */
  value: string;
  /** The decimal places the server keeps: BigDecimal's scale, never below zero in its plain text. */
  places: bigint;
}

function decimal(text: string): Decimal | null {
  const parts = decimalTextParts(text);
  if (!parts) return null;
  const scale = BigInt(parts.fraction.length) - parts.exponent;
  const places = scale > 0n ? scale : 0n;
  const { digits, trailingZeros } = significantDigits(parts);
  // Zero has one value whatever its sign or exponent; only its places remain.
  if (!digits) return { value: "0", places };
  const coefficient = digits.slice(0, digits.length - trailingZeros);
  const power = -scale + BigInt(trailingZeros);
  return {
    value: `${parts.negative ? "-" : ""}${coefficient}e${power}`,
    places,
  };
}

/**
 * The number written in `text` as the server keeps it: its decimal value and
 * its decimal places, computed from the token without expanding exponents.
 * "1.50e1" and "15.0" share one key, "15" has another; null for other text.
 */
export function decimalKey(text: string): string | null {
  const parsed = decimal(text);
  return parsed && `${parsed.value}|${parsed.places}`;
}

/**
 * Whether sending the double `value` as JSON gives the server the number
 * written in `text`: the same decimal value with the same decimal places.
 * Exponent spelling and leading zeros may differ ("1E2" and 100 match, as do
 * ".5" and 0.5); rounding, overflow, underflow and a lost decimal place ("2.50"
 * and 2.5) do not.
 */
export function doubleKeepsDecimal(text: string, value: number): boolean {
  if (!Number.isFinite(value)) return false;
  const serialized = JSON.stringify(value);
  return serialized === text || decimalKey(serialized) === decimalKey(text);
}

/**
 * Whether two JSON numbers are the same number to the server: the same decimal
 * value with the same decimal places, e.g. a double and a DecimalNumber, or two
 * DecimalNumbers spelled "1.50e1" and "15.0".
 */
export function sameJsonNumber(
  left: number | DecimalNumber,
  right: number | DecimalNumber,
): boolean {
  if (isDecimalNumber(left)) {
    if (isDecimalNumber(right))
      return decimalKey(left.text) === decimalKey(right.text);
    return doubleKeepsDecimal(left.text, right);
  }
  if (isDecimalNumber(right)) return doubleKeepsDecimal(right.text, left);
  // Equal decimal values are equal doubles; JSON writes -0 as 0.
  return left === right;
}

/**
 * Parses JSON with the grammar and SyntaxError behavior of JSON.parse. Numbers
 * that a double would change become DecimalNumber values, and `__proto__` keys
 * become own properties, as with JSON.parse.
 */
export function parseJson(text: string): unknown {
  return new JsonReader(text).document();
}

/** Parses a JSON object; valid JSON of another shape throws `new Error(message)`. */
export function parseJsonObject(
  text: string,
  message: string,
): Record<string, unknown> {
  const value = parseJson(text);
  if (!isJsonObject(value)) throw new Error(message);
  return value;
}

/**
 * JSON.stringify(value, null, space), except that a DecimalNumber is written as
 * its original number token. This works without JSON.rawJSON: each DecimalNumber
 * is serialized as a marker string, which is then replaced by its token.
 */
export function stringifyJson(value: unknown, space?: number): string {
  for (;;) {
    const marker = `arc-decimal-${Math.random().toString(36).slice(2)}-`;
    const tokens: string[] = [];
    const text = JSON.stringify(
      value,
      function (this: Record<string, unknown>, key: string, current: unknown) {
        // `current` has already passed through toJSON; the holder keeps the original.
        const original = this[key];
        if (!isDecimalNumber(original)) return current;
        tokens.push(original.text);
        return `${marker}${tokens.length - 1}`;
      },
      space,
    );
    if (!tokens.length) return text;
    // A string containing the marker would also be replaced, so choose another marker.
    if (text.split(marker).length - 1 !== tokens.length) continue;
    return text.replace(
      new RegExp(`"${marker}(\\d+)"`, "g"),
      (_placeholder, index: string) => tokens[Number(index)],
    );
  }
}

type OpenContainer =
  | { kind: "array"; value: unknown[] }
  | { kind: "object"; value: Record<string, unknown>; key: string };

const containerOpened = Symbol("container opened");

/** Reads one document iteratively, so deep nesting cannot exhaust the call stack. */
class JsonReader {
  private position = 0;
  private readonly whitespace = /[ \t\n\r]*/y;
  private readonly number = new RegExp(numberGrammar, "y");
  private readonly stringBoundary = /["\\\u0000-\u001f]/g;

  constructor(private readonly text: string) {}

  document(): unknown {
    const open: OpenContainer[] = [];
    for (;;) {
      let value = this.valueStart(open);
      if (value === containerOpened) continue;
      // A completed value may also complete the containers that hold it.
      for (;;) {
        const container = open.at(-1);
        if (!container) return this.end(value);
        if (container.kind === "array") container.value.push(value);
        else addEntry(container.value, container.key, value);
        if (this.nextElement(container)) break;
        open.pop();
        value = container.value;
      }
    }
  }

  /** Returns a scalar or empty container, or opens a container that has elements. */
  private valueStart(open: OpenContainer[]): unknown {
    this.skipWhitespace();
    const opening = this.text[this.position];
    if (opening !== "[" && opening !== "{") return this.scalar();
    this.position++;
    this.skipWhitespace();
    if (opening === "[") {
      if (this.consume("]")) return [];
      open.push({ kind: "array", value: [] });
    } else {
      if (this.consume("}")) return {};
      open.push({ kind: "object", value: {}, key: this.propertyName() });
    }
    return containerOpened;
  }

  /** Consumes a separator (true: another element follows) or the closing bracket (false). */
  private nextElement(container: OpenContainer): boolean {
    this.skipWhitespace();
    if (this.consume(",")) {
      if (container.kind === "object") {
        this.skipWhitespace();
        container.key = this.propertyName();
      }
      return true;
    }
    if (this.consume(container.kind === "array" ? "]" : "}")) return false;
    throw this.unexpected();
  }

  /** Reads `"name" :` at the current position. */
  private propertyName(): string {
    if (this.text[this.position] !== '"') throw this.unexpected();
    const name = this.string();
    this.skipWhitespace();
    if (!this.consume(":")) throw this.unexpected();
    return name;
  }

  private end(value: unknown): unknown {
    this.skipWhitespace();
    if (this.position < this.text.length) throw this.unexpected();
    return value;
  }

  private scalar(): unknown {
    switch (this.text[this.position]) {
      case '"':
        return this.string();
      case "t":
        return this.literal("true", true);
      case "f":
        return this.literal("false", false);
      case "n":
        return this.literal("null", null);
      default:
        return this.numberValue();
    }
  }

  private string(): string {
    const start = this.position;
    let index = start + 1;
    let escaped = false;
    for (;;) {
      this.stringBoundary.lastIndex = index;
      const boundary = this.stringBoundary.exec(this.text);
      if (!boundary)
        throw new SyntaxError(
          `Unterminated string in JSON at position ${this.text.length}`,
        );
      index = boundary.index;
      if (boundary[0] === '"') break;
      if (boundary[0] !== "\\")
        throw new SyntaxError(
          `Bad control character in string literal in JSON at position ${index}`,
        );
      escaped = true;
      index += 2; // The escaped character cannot end the string.
    }
    this.position = index + 1;
    if (!escaped) return this.text.slice(start + 1, index);
    try {
      // JSON.parse owns escape decoding, including \u surrogate pairs.
      const decoded: string = JSON.parse(this.text.slice(start, index + 1));
      return decoded;
    } catch {
      throw new SyntaxError(
        `Bad escaped character in the JSON string at position ${start}`,
      );
    }
  }

  private numberValue(): number | DecimalNumber {
    this.number.lastIndex = this.position;
    const token = this.number.exec(this.text)?.[0];
    if (!token) throw this.unexpected();
    this.position += token.length;
    const value = Number(token);
    return doubleKeepsDecimal(token, value) ? value : new DecimalNumber(token);
  }

  private literal<T>(word: string, value: T): T {
    if (!this.text.startsWith(word, this.position)) throw this.unexpected();
    this.position += word.length;
    return value;
  }

  private consume(character: string): boolean {
    if (this.text[this.position] !== character) return false;
    this.position++;
    return true;
  }

  private skipWhitespace() {
    this.whitespace.lastIndex = this.position;
    this.whitespace.exec(this.text);
    this.position = this.whitespace.lastIndex;
  }

  private unexpected(): SyntaxError {
    if (this.position >= this.text.length)
      return new SyntaxError("Unexpected end of JSON input");
    return new SyntaxError(
      `Unexpected token '${this.text[this.position]}' in JSON at position ${this.position}`,
    );
  }
}

function addEntry(
  object: Record<string, unknown>,
  key: string,
  value: unknown,
) {
  // Assigning "__proto__" would replace the prototype; JSON.parse defines an own property.
  if (key === "__proto__")
    Object.defineProperty(object, key, {
      value,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  else object[key] = value;
}
