// Literal syntax mirrors the server tokenizer (ExpressionParser.TOKEN). A looser
// pattern would show text the server rejects as a valid typed constant.

import { MAX_EXPRESSION_TOKENS } from "./limits";
import { trimAsServer } from "./serverText";

// JSON escapes are part of ARC's string contract.
export const quoteText = (text: string) => JSON.stringify(text);

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

// The server's token classes, in its order: a number, a name or call (a unary
// minus is its own token), a quoted string, then an operator or punctuation.
const expressionToken =
  /[\u0000-\u0020]*(?:\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\.\d+|\$?[A-Za-z_][A-Za-z_0-9.]*|@[A-Za-z_][A-Za-z_0-9-]*(?::[0-9]+)?|"[^"\\]*(?:\\.[^"\\]*)*"|'[^'\\]*(?:\\.[^'\\]*)*'|&&|\|\||==|!=|<>|<=|>=|[=^[\]+*/%<>()!,\-])/y;

/**
 * How many tokens the server reads from `text` before it stops, or Infinity
 * once the text holds something it cannot read.
 */
function expressionTokenCount(text: string): number {
  const source = trimAsServer(text);
  let count = 0;
  expressionToken.lastIndex = 0;
  while (expressionToken.lastIndex < source.length) {
    if (!expressionToken.exec(source)) return Infinity;
    count++;
  }
  return count;
}

/** Whether the server's tokenizer refuses `text` for its length alone. */
export function exceedsTokenLimit(text: string): boolean {
  return expressionTokenCount(text) > MAX_EXPRESSION_TOKENS;
}

/**
 * JSON arrays of numbers, strings, booleans, null and nested arrays, within
 * the server's token limit; ARC has no object literal.
 */
export function isArrayLiteral(text: string): boolean {
  return jsonArray(text) !== null && !exceedsTokenLimit(text);
}

/**
 * Why the server refuses the JSON array `text` as one literal, or null when it
 * reads it as one or when the text is no JSON array at all.
 */
export function arrayLiteralProblem(text: string): string | null {
  if (jsonArray(text) === null || !exceedsTokenLimit(text)) return null;
  return `Array literals are limited to ${MAX_EXPRESSION_TOKENS} tokens (about 127 numbers); pass a longer list as an input parameter or a data source.`;
}

function jsonArray(text: string): unknown[] | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  return Array.isArray(value) && !containsObject(value) ? value : null;
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
function topLevelText(expression: string): string | null {
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

// Server priorities: ||/OR, then &&/AND, then equality, then ordering. An
// operand that carries any of them binds no tighter than the comparison it
// sits in.
const comparisonOperator = /==|!=|<>|<=|>=|=|<|>/;
// The keywords are upper-case only (BinaryOperator): `and` is an identifier,
// `$AND` a function token and `x.AND` a path.
const logicalKeyword = /(?<![\w$.])(?:AND|OR)(?![\w.])/g;

/**
 * Whether the top level of `expression` (masked to `masked`) holds a logical
 * operator. A keyword after an operand is one; first in a term it names a call,
 * `AND(a, b)`, which the parser reads as a function.
 */
function hasTopLevelLogic(expression: string, masked: string): boolean {
  if (/&&|\|\|/.test(masked)) return true;
  for (const match of masked.matchAll(logicalKeyword)) {
    const before = expression.slice(0, match.index).trimEnd();
    if (/[\w$)\]"']$/.test(before)) return true;
  }
  return false;
}

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
    const compound =
      top !== null &&
      (comparisonOperator.test(top) || hasTopLevelLogic(trimmed, top));
    return compound ? `(${trimmed})` : trimmed;
  };
  return [operand(left), operator, operand(right)].join(" ");
}

/**
 * The builder's reading of a single comparison, or null. Every comparison
 * operator the server reads counts, its aliases `=` and `<>` included:
 * "score > 50 = passed" means (score > 50) = passed, which was shown as
 * score > (50 = passed) and stored so on the next edit. The builder offers
 * the canonical spellings only, so a comparison written with an alias stays in
 * the expression editor as written.
 */
export function simpleComparison(expression: string): string[] | null {
  const masked = topLevelText(expression);
  if (masked === null || hasTopLevelLogic(expression, masked)) return null;
  const operators = [
    ...masked.matchAll(new RegExp(comparisonOperator.source, "g")),
  ];
  if (operators.length !== 1) return null;
  const operator = operators[0],
    index = operator.index!;
  if (operator[0] === "=" || operator[0] === "<>") return null;
  return [
    expression,
    expression.slice(0, index).trim(),
    operator[0],
    expression.slice(index + operator[0].length).trim(),
  ];
}
