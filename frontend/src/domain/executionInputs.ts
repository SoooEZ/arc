import type { Definition, ExecutionOptions, Input } from "../types";

function sampleValue(input: Input): unknown {
  if (input.defaultValue != null) return input.defaultValue;
  switch (input.type) {
    case "ARRAY":
      return [];
    case "OBJECT":
      return {};
    case "NUMBER":
      return input.name === "rate" ? 0.1 : 150;
    case "BOOLEAN":
      return true;
    case "STRING":
      return input.name === "customerTier" ? "premium" : "example";
  }
}

export function sampleInputs(definition: Definition): Record<string, unknown> {
  return Object.fromEntries(
    definition.inputs
      .filter(
        (input) =>
          !input.source && (input.required || input.defaultValue != null),
      )
      .map((input) => [input.name, sampleValue(input)]),
  );
}

export function parseExecutionInputs(text: string): Record<string, unknown> {
  const value: unknown = JSON.parse(text);
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("Inputs must be a JSON object.");
  return value as Record<string, unknown>;
}

export function curlExample(
  origin: string,
  id: string,
  inputs: Record<string, unknown>,
  version?: number | null,
  options: ExecutionOptions = {},
) {
  const body = JSON.stringify(
    { inputs, ...(version ? { version } : {}), ...options },
    null,
    2,
  );
  return `curl -X POST '${origin}/api/rules/${id}/execute' \\\n  -H 'Content-Type: application/json' \\\n  -d '${body.replace(/'/g, "'\\''")}'`;
}
