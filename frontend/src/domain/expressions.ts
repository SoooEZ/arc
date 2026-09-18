// Use ARC's escapes; plain text is never treated as executable source.
export const quoteText = (text: string) =>
  '"' +
  text
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("\n", "\\n")
    .replaceAll("\r", "\\r")
    .replaceAll("\t", "\\t") +
  '"';
export function literalText(value: string): string | null {
  if (!/^("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')$/s.test(value)) return null;
  return value
    .slice(1, -1)
    .replace(
      /\\(.)/gs,
      (_, c: string) => ({ n: "\n", r: "\r", t: "\t" })[c] ?? c,
    );
}

export function simpleComparison(expression: string): string[] | null {
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
  if (quote || /&&|\|\||\b(?:and|or)\b/i.test(masked)) return null;
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
