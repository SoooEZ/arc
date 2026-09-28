import type { ConstantType } from "../../src/domain/valueBinding";

export interface LiteralCase {
  /** Expression text as stored in the graph. */
  text: string;
  /** The typed constant the editor offers, or null when the text stays an expression. */
  constant: ConstantType | null;
  /**
   * What the server's expression parser does with the text: one literal (a
   * number may carry a unary minus), a compound or variable expression, or an
   * error. The editor never offers a constant for text the server rejects.
   */
  server: "literal" | "expression" | "error";
  /** The decoded string of a STRING literal. */
  value?: string;
}

/**
 * One table for the literal classifiers (lesson K40). The server column was
 * checked with Expressions.compile/evaluate. Number magnitude limits (precision
 * and scale 100) are value errors reported by diagnostics, not syntax, so they
 * are not listed here.
 */
export const literalCases: readonly LiteralCase[] = [
  { text: "0", constant: "NUMBER", server: "literal" },
  { text: "42", constant: "NUMBER", server: "literal" },
  // unary minus on a number
  { text: "-7", constant: "NUMBER", server: "literal" },
  { text: "-0", constant: "NUMBER", server: "literal" },
  { text: "1.25e2", constant: "NUMBER", server: "literal" },
  { text: "1E+5", constant: "NUMBER", server: "literal" },
  { text: "2e-3", constant: "NUMBER", server: "literal" },
  { text: ".5", constant: "NUMBER", server: "literal" },
  { text: "-.5", constant: "NUMBER", server: "literal" },
  { text: "007", constant: "NUMBER", server: "literal" },
  { text: "00.5", constant: "NUMBER", server: "literal" },
  // the server trims code units up to U+0020
  { text: " 12 ", constant: "NUMBER", server: "literal" },
  { text: "\t12\n", constant: "NUMBER", server: "literal" },
  { text: "\u000112", constant: "NUMBER", server: "literal" },
  // no trailing dot
  { text: "1.", constant: null, server: "error" },
  { text: "1.e5", constant: null, server: "error" },
  // no exponent after a leading dot
  { text: ".5e3", constant: null, server: "error" },
  { text: "-.5e3", constant: null, server: "error" },
  { text: "1e", constant: null, server: "error" },
  { text: "1e+", constant: null, server: "error" },
  { text: "-", constant: null, server: "error" },
  { text: "1_000", constant: null, server: "error" },
  { text: "0x10", constant: null, server: "error" },
  { text: "1,5", constant: null, server: "error" },
  // no-break space is not trimmed
  { text: "\u00a012", constant: null, server: "error" },
  { text: "12\u00a0", constant: null, server: "error" },
  { text: "\u202812", constant: null, server: "error" },
  // ASCII digits only
  { text: "\uff11\uff12", constant: null, server: "error" },
  // unary plus stays an expression
  { text: "+5", constant: null, server: "expression" },
  { text: "- 5", constant: null, server: "expression" },
  // a variable name
  { text: "Infinity", constant: null, server: "expression" },
  { text: "NaN", constant: null, server: "expression" },
  { text: '"a"', constant: "STRING", server: "literal", value: "a" },
  { text: "'a'", constant: "STRING", server: "literal", value: "a" },
  { text: '""', constant: "STRING", server: "literal", value: "" },
  { text: "''", constant: "STRING", server: "literal", value: "" },
  {
    text: String.raw`"a \"quote\""`,
    constant: "STRING",
    server: "literal",
    value: 'a "quote"',
  },
  {
    text: String.raw`'it\'s'`,
    constant: "STRING",
    server: "literal",
    value: "it's",
  },
  {
    text: String.raw`"\u0041"`,
    constant: "STRING",
    server: "literal",
    value: "A",
  },
  // legacy unknown escape
  { text: String.raw`"\q"`, constant: "STRING", server: "literal", value: "q" },
  {
    text: String.raw`"line\nbreak"`,
    constant: "STRING",
    server: "literal",
    value: "line\nbreak",
  },
  // a raw line break inside quotes
  { text: '"a\nb"', constant: "STRING", server: "literal", value: "a\nb" },
  {
    text: '"a\u2028b"',
    constant: "STRING",
    server: "literal",
    value: "a\u2028b",
  },
  {
    text: '"a\u0085b"',
    constant: "STRING",
    server: "literal",
    value: "a\u0085b",
  },
  {
    text: String.raw`"\uD83D\uDE00"`,
    constant: "STRING",
    server: "literal",
    value: "😀",
  },
  {
    text: String.raw`'\u0041\b\f\q'`,
    constant: "STRING",
    server: "literal",
    value: "A\b\fq",
  },
  { text: ' "a" ', constant: "STRING", server: "literal", value: "a" },
  // a backslash cannot escape a line terminator
  { text: '"a\\\nb"', constant: null, server: "error" },
  { text: '"a\\\rb"', constant: null, server: "error" },
  { text: '"a\\\u2028b"', constant: null, server: "error" },
  { text: '"a\\\u2029b"', constant: null, server: "error" },
  { text: '"a\\\u0085b"', constant: null, server: "error" },
  // malformed Unicode escape
  { text: String.raw`"\u12"`, constant: null, server: "error" },
  { text: '"unterminated', constant: null, server: "error" },
  { text: '"a"b"', constant: null, server: "error" },
  { text: '\u00a0"a"', constant: null, server: "error" },
  { text: '"a"\u00a0', constant: null, server: "error" },
  { text: '"a" == "b"', constant: null, server: "expression" },
  { text: "true", constant: "BOOLEAN", server: "literal" },
  { text: "FALSE", constant: "BOOLEAN", server: "literal" },
  { text: " True ", constant: "BOOLEAN", server: "literal" },
  { text: "null", constant: "NULL", server: "literal" },
  { text: "NULL", constant: "NULL", server: "literal" },
  { text: "nul", constant: null, server: "expression" },
  { text: "[]", constant: "ARRAY", server: "literal" },
  { text: "[1,2]", constant: "ARRAY", server: "literal" },
  {
    text: '[1, "two", false, null, [3]]',
    constant: "ARRAY",
    server: "literal",
  },
  // ARC has no object literal
  { text: '[{"a":1}]', constant: null, server: "error" },
  { text: '[[{"a":1}]]', constant: null, server: "error" },
  { text: "[1, 2,]", constant: null, server: "error" },
  { text: '["a\\\nb"]', constant: null, server: "error" },
  { text: "[amount]", constant: null, server: "expression" },
  // accepted by the server, but only JSON arrays become constants
  { text: "[.5]", constant: null, server: "literal" },
  { text: "[1, 'two']", constant: null, server: "literal" },
];
