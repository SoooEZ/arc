import type { VariableOption } from "./graph";

export type ExpressionSymbolKind =
  "function" | "formula" | "parameter" | "variable" | "variable.local";
export interface ExpressionSymbol {
  offset: number;
  length: number;
  kind: ExpressionSymbolKind;
}
interface Token {
  text: string;
  offset: number;
  identifier: boolean;
}
interface LocalScope {
  name: string;
  declaration: number;
  start: number;
  end: number;
}
// ARC property paths also allow numeric segments, such as items.0.price.
const identifier =
  /^(?:@[a-z][a-z0-9-]*(?::[1-9]\d*)?|\$?[A-Za-z_][A-Za-z_0-9.]*)$/;
const localIdentifier = /^[A-Za-z_][A-Za-z_0-9]*$/;
const inputTypes = new Set(["NUMBER", "STRING", "BOOLEAN", "ARRAY", "OBJECT"]);
const collections = new Set(["MAP", "FILTER", "ALL", "ANY", "REDUCE"]);

/** This lexer only classifies visible names; execution and scope validation remain on the server. */
function tokens(source: string): Token[] {
  const pattern =
    /\/\/[^\r\n]*|"(?:[^"\\]|\\[\s\S])*(?:"|$)|'(?:[^'\\]|\\[\s\S])*(?:'|$)|@[a-z][a-z0-9-]*(?::[1-9]\d*)?|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|\$?[A-Za-z_][A-Za-z_0-9.]*|[^\s]/g;
  return [...source.matchAll(pattern)]
    .filter((match) => !match[0].startsWith("//"))
    .map((match) => ({
      text: match[0],
      offset: match.index,
      identifier: identifier.test(match[0]),
    }));
}

/** Collection binders are visible only in the body, not in the collection or REDUCE initial value. */
function localScopes(tokens: Token[]): LocalScope[] {
  const scopes: LocalScope[] = [];
  const stack: { open: number; commas: number[] }[] = [];
  const finish = (frame: { open: number; commas: number[] }, end: number) => {
    if (tokens[frame.open].text !== "(") return;
    const name = tokens[frame.open - 1]?.text.replace(/^\$/, "").toUpperCase();
    if (!collections.has(name)) return;
    const starts = [frame.open + 1, ...frame.commas.map((index) => index + 1)];
    const ends = [...frame.commas, end];
    const body = name === "REDUCE" ? 4 : 2;
    for (const argument of name === "REDUCE" ? [1, 2] : [1]) {
      const declaration = starts[argument];
      const binder = tokens[declaration];
      if (
        !binder ||
        ends[argument] !== declaration + 1 ||
        !localIdentifier.test(binder.text)
      )
        continue;
      scopes.push({
        name: binder.text,
        declaration,
        start: starts[body] ?? end,
        end,
      });
    }
  };
  for (let index = 0; index < tokens.length; index++) {
    const text = tokens[index].text;
    if (["(", "[", "{"].includes(text)) stack.push({ open: index, commas: [] });
    else if ([")", "]", "}"].includes(text)) {
      const frame = stack.pop();
      if (frame) finish(frame, index);
    } else if (text === ",") stack.at(-1)?.commas.push(index);
  }
  // Incomplete calls are common while typing; retain any already declared body scope.
  for (const frame of stack) finish(frame, tokens.length);
  return scopes;
}

/** Locate expression statements/declarations without treating node IDs, bindings or JSON data as variables. */
function scriptNames(
  tokens: Token[],
  names: Map<string, ExpressionSymbolKind>,
) {
  const expressions = new Set<number>();
  const declarations = new Map<number, ExpressionSymbolKind>();
  for (let index = 0; index < tokens.length; index++) {
    if (index && ![";", "{", "}"].includes(tokens[index - 1].text)) continue;
    const token = tokens[index];
    let end = index;
    while (end < tokens.length && tokens[end].text !== ";") end++;
    const declare = (at: number, kind: ExpressionSymbolKind) => {
      if (!tokens[at]?.identifier || !localIdentifier.test(tokens[at].text))
        return;
      declarations.set(at, kind);
      names.set(tokens[at].text, kind);
    };
    if (
      tokens[index + 1]?.text === ":" &&
      inputTypes.has(tokens[index + 2]?.text)
    ) {
      declare(index, "parameter");
      continue;
    }
    if (token.text === "as") declare(index + 1, "variable");
    if (token.text === "source") declare(index + 1, "parameter");
    let start = end;
    if (["when", "select", "return"].includes(token.text)) start = index + 1;
    if (["let", "field", "bind"].includes(token.text)) {
      if (token.text === "let") declare(index + 1, "variable");
      for (let at = index + 1; at < end; at++) {
        if (tokens[at].text === "=") {
          start = at + 1;
          break;
        }
      }
    }
    if (token.text === "case") {
      for (let at = index + 1; at < end; at++) {
        if (["when", "equals"].includes(tokens[at].text)) {
          start = at + 1;
          break;
        }
      }
    }
    for (let at = start; at < end; at++) expressions.add(at);
  }
  return { expressions, declarations };
}

export function expressionSymbols(
  source: string,
  variables: VariableOption[],
  script = false,
): ExpressionSymbol[] {
  const lexical = tokens(source);
  const names = new Map<string, ExpressionSymbolKind>(
    variables.map((variable) => [
      variable.name,
      variable.type === "RESULT" ? "variable" : "parameter",
    ]),
  );
  const scriptContext = script ? scriptNames(lexical, names) : null;
  const locals = localScopes(lexical);
  const symbols: ExpressionSymbol[] = [];
  for (let index = 0; index < lexical.length; index++) {
    const token = lexical[index];
    if (!token.identifier) continue;
    const declaration = scriptContext?.declarations.get(index);
    if (scriptContext && !declaration && !scriptContext.expressions.has(index))
      continue;
    // Only the root is a variable: the property in customer.amount is not the input amount.
    const root = token.text.split(".")[0];
    let kind: ExpressionSymbolKind | undefined = declaration;
    let length = root.length;
    if (token.text.startsWith("@")) {
      kind = "formula";
      length = token.text.length;
    }
    if (
      !kind &&
      (token.text.startsWith("$") || lexical[index + 1]?.text === "(")
    ) {
      kind = "function";
      length = token.text.length;
    }
    if (
      !kind &&
      locals.some(
        (local) =>
          local.name === root &&
          (index === local.declaration ||
            (index >= local.start && index < local.end)),
      )
    )
      kind = "variable.local";
    if (!kind) kind = names.get(root);
    if (kind) symbols.push({ offset: token.offset, length, kind });
  }
  return symbols;
}
