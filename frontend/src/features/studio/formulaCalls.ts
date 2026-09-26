import { ruleApi } from "../../api/rules";
import type { Input, RuleSummary } from "../../types";

export interface FormulaEntry {
  id: string;
  name: string;
  version: number;
  inputs: Input[];
}

export function formulaCallName(formula: Pick<FormulaEntry, "id" | "version">) {
  return `@${formula.id}:${formula.version}`;
}

function snippetLiteral(text: string) {
  return text.replace(/[$}\\]/g, "\\$&");
}

function defaultExpression(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map(defaultExpression).join(", ")}]`;
  if (value && typeof value === "object")
    return `$OBJECT(${Object.entries(value)
      .flatMap(([key, entry]) => [
        JSON.stringify(key),
        defaultExpression(entry),
      ])
      .join(", ")})`;
  return JSON.stringify(value) ?? "null";
}

export function formulaSnippet(formula: FormulaEntry, available: string[]) {
  let count = formula.inputs.length;
  while (count) {
    const input = formula.inputs[count - 1];
    if (
      available.includes(input.name) ||
      (input.required && input.defaultValue == null && !input.source)
    )
      break;
    count--;
  }
  const arguments_ = formula.inputs.slice(0, count).map((input, index) => {
    let value = input.name;
    if (!available.includes(input.name)) {
      if (input.defaultValue !== undefined && input.defaultValue !== null)
        value = defaultExpression(input.defaultValue);
      else if (!input.required) value = "null";
      else if (input.type === "STRING") value = '"value"';
      else if (input.type === "NUMBER") value = "0";
      else if (input.type === "BOOLEAN") value = "false";
      else if (input.type === "ARRAY") value = "[]";
      else value = "null";
    }
    return "${" + (index + 1) + ":" + snippetLiteral(value) + "}";
  });
  return `${formulaCallName(formula)}(${arguments_.join(", ")})`;
}

export function formulaSignature(formula: FormulaEntry) {
  return `${formulaCallName(formula)}(${formula.inputs.map((input) => `${input.name}: ${input.type.toLowerCase()}`).join(", ")})`;
}

export function formulaParameterDescription(input: Input) {
  const fallback =
    input.defaultValue === undefined || input.defaultValue === null
      ? ""
      : ` · default ${JSON.stringify(input.defaultValue)}`;
  return `${input.name} (${input.type.toLowerCase()}) · ${input.required ? "required" : "optional"}${fallback}${input.source ? " · data source" : ""}`;
}

/** A bounded editor-local cache contains only immutable published input metadata. */
export class FormulaMetadata {
  private readonly entries = new Map<string, FormulaEntry>();

  async load(
    id: string,
    version: number,
    signal: AbortSignal,
    summary?: RuleSummary,
  ) {
    const key = `${id}:${version}`;
    const cached = this.entries.get(key);
    if (cached) return cached;
    const rule = summary ?? (await ruleApi.get(id, { signal }));
    if (rule.kind !== "FORMULA")
      throw new Error(
        "Only published Formula rules can be called in an expression.",
      );
    const published = await ruleApi.version(id, version, { signal });
    const formula: FormulaEntry = {
      id,
      name: rule.name,
      version,
      inputs: published.definition.inputs,
    };
    if (!signal.aborted) {
      this.entries.set(key, formula);
      if (this.entries.size > 64)
        this.entries.delete(this.entries.keys().next().value!);
    }
    return formula;
  }

  async search(search: string, signal: AbortSignal) {
    const page = await ruleApi.catalog(
      { search, kind: "FORMULA", publishedOnly: true, offset: 0, limit: 8 },
      { signal },
    );
    const results = await Promise.allSettled(
      page.items
        .filter((rule) => rule.publishedVersion !== null)
        .map((rule) =>
          this.load(rule.id, rule.publishedVersion!, signal, rule),
        ),
    );
    if (signal.aborted) return [];
    return results.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );
  }
}
