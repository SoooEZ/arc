// Literal syntax mirrors the server tokenizer (ExpressionParser.TOKEN). A looser
// pattern would show text the server rejects as a valid typed constant.

// JSON escapes are part of ARC's string contract.
export const quoteText = (text: string) => JSON.stringify(text);

/** The server trims UTF-16 code units up to U+0020 (Java String.trim) before tokenizing. */
export function trimExpression(source: string): string {
  return source.replace(/^[\u0000-\u0020]+|[\u0000-\u0020]+$/g, "");
}

// A backslash escapes any character except a line terminator: the server's
// `\\.` excludes \n, \r, U+0085, U+2028 and U+2029.
const stringToken =
  /^("(?:[^"\\]|\\[^\n\r\u0085\u2028\u2029])*"|'(?:[^'\\]|\\[^\n\r\u0085\u2028\u2029])*')$/;

export function literalText(value: string): string | null {
  if (!stringToken.test(value)) return null;
  // Normalize ARC's single quotes, raw characters and legacy unknown escapes.
  // JSON.parse then owns Unicode validation and all standard escape decoding.
  const body = value
    .slice(1, -1)
    .replace(
      /\\(.)|([^\\])/gs,
      (match, escaped: string | undefined, plain: string | undefined) => {
        if (escaped !== undefined && 'u"\\/bfnrt'.includes(escaped))
          return match;
        return JSON.stringify(escaped ?? plain).slice(1, -1);
      },
    );
  try {
    return JSON.parse(`"${body}"`) as string;
  } catch {
    return null;
  }
}

// The server has no leading-dot exponent (.5e3) or trailing dot (1., 1.e5).
// A directly attached minus sign is ARC's unary negation of the number.
const numberToken = /^-?(?:\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\.\d+)$/;

export function isNumberLiteral(text: string): boolean {
  return numberToken.test(text);
}

/** JSON arrays of numbers, strings, booleans, null and nested arrays; ARC has no object literal. */
export function isArrayLiteral(text: string): boolean {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return false;
  }
  return Array.isArray(value) && !containsObject(value);
}

function containsObject(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsObject);
  return value !== null && typeof value === "object";
}

/**
 * The expression with quoted text and bracketed or parenthesized spans blanked
 * out (each character becomes a space, so offsets are kept), leaving only the
 * operators that apply at the top level. Null while a quote is unterminated.
 */
export function topLevelText(expression: string): string | null {
  let masked = "",
    quote = "",
    escaped = false,
    depth = 0;
  for (const c of expression) {
    if (quote) {
      masked += " ".repeat(c.length);
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === quote) quote = "";
    } else if (c === '"' || c === "'") {
      quote = c;
      masked += " ".repeat(c.length);
    } else if (c === "(" || c === "[") {
      depth++;
      masked += " ".repeat(c.length);
    } else if (c === ")" || c === "]") {
      depth--;
      masked += " ".repeat(c.length);
    } else masked += depth ? " " : c;
  }
  return quote ? null : masked;
}

// Server priorities: ||/or, then &&/and, then equality, then ordering. An operand
// that carries any of them binds no tighter than the comparison it sits in.
const logicalOrComparison = /&&|\|\||\b(?:and|or)\b|==|!=|<>|<=|>=|=|<|>/i;

/**
 * A stored comparison from the builder's operands. An operand that contains a
 * logical or comparison operator at its top level is parenthesized, so that
 * `flag == (a || b)` is stored where `flag == a || b` would mean
 * `(flag == a) || b`. Text with an open quote is still being typed and is left
 * as it is.
 */
export function comparisonText(
  left: string,
  operator: string,
  right: string,
): string {
  const operand = (text: string) => {
    const trimmed = text.trim();
    const top = topLevelText(trimmed);
    return top !== null && logicalOrComparison.test(top)
      ? `(${trimmed})`
      : trimmed;
  };
  return [operand(left), operator, operand(right)].join(" ");
}

export function simpleComparison(expression: string): string[] | null {
  const masked = topLevelText(expression);
  if (masked === null || /&&|\|\||\b(?:and|or)\b/i.test(masked)) return null;
  const operators = [...masked.matchAll(/==|!=|>=|<=|>|</g)];
  if (operators.length !== 1) return null;
  const operator = operators[0],
    index = operator.index!;
  return [
    expression,
    expression.slice(0, index).trim(),
    operator[0],
    expression.slice(index + operator[0].length).trim(),
  ];
}
