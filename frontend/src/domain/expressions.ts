// JSON escapes are part of ARC's string contract.
export const quoteText = (text: string) => JSON.stringify(text);
export function literalText(value: string): string | null {
  if (!/^("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')$/s.test(value)) return null;
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
