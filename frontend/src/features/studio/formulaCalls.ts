import type { Input } from "../../types";
import { quoteText } from "../../domain/expressions";
import {
  isDecimalNumber,
  isJsonObject,
  stringifyJson,
} from "../../domain/json";
import { placeholderLiteral } from "../../domain/placeholderLiterals";
import { escapeSnippetText } from "./snippets";

export interface FormulaEntry {
  id: string;
  name: string;
  version: number;
  inputs: Input[];
}

export function formulaCallName(formula: Pick<FormulaEntry, "id" | "version">) {
  return `@${formula.id}:${formula.version}`;
}

/** The ARC expression that rebuilds a JSON default value, e.g. {"a": [1]} -> $OBJECT("a", [1]). */
function valueExpression(value: unknown): string {
  if (isDecimalNumber(value)) return value.text;
  if (typeof value === "string") return quoteText(value);
  if (typeof value === "number" || typeof value === "boolean")
    return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(valueExpression).join(", ")}]`;
  if (isJsonObject(value)) {
    const entries = Object.entries(value).flatMap(([key, entry]) => [
      quoteText(key),
      valueExpression(entry),
    ]);
    return `$OBJECT(${entries.join(", ")})`;
  }
  return "null";
}

/** An in-scope variable of the same name, the input's default, null for an optional input, else a typed placeholder. */
function argumentExpression(input: Input, available: string[]): string {
  if (available.includes(input.name)) return input.name;
  if (input.defaultValue != null) return valueExpression(input.defaultValue);
  if (!input.required) return "null";
  return placeholderLiteral[input.type];
}

/** Arguments run through the last input that is in scope or has no fallback; later inputs are omitted. */
function insertedArgumentCount(inputs: Input[], available: string[]): number {
  let count = inputs.length;
  while (count > 0) {
    const input = inputs[count - 1];
    const needsArgument =
      input.required && input.defaultValue == null && !input.source;
    if (available.includes(input.name) || needsArgument) break;
    count--;
  }
  return count;
}

export function formulaSnippet(formula: FormulaEntry, available: string[]) {
  const count = insertedArgumentCount(formula.inputs, available);
  const placeholders = formula.inputs
    .slice(0, count)
    .map(
      (input, index) =>
        `\${${index + 1}:${escapeSnippetText(argumentExpression(input, available))}}`,
    );
  return `${formulaCallName(formula)}(${placeholders.join(", ")})`;
}

export function formulaSignature(formula: FormulaEntry) {
  return `${formulaCallName(formula)}(${formula.inputs.map((input) => `${input.name}: ${input.type.toLowerCase()}`).join(", ")})`;
}

export function formulaParameterDescription(input: Input) {
  const fallback =
    input.defaultValue == null
      ? ""
      : ` · default ${stringifyJson(input.defaultValue)}`;
  return `${input.name} (${input.type.toLowerCase()}) · ${input.required ? "required" : "optional"}${fallback}${input.source ? " · data source" : ""}`;
}
