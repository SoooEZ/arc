import type { Definition, ExecutionOptions, Input } from "../types";
import { isJsonObject, parseJsonObject, stringifyJson } from "./json";

/** Placeholder text that makes the bundled pricing rule and tax lookup take a meaningful path. */
const sampleTexts = new Map([
  ["customerTier", "premium"],
  ["key", "US"],
]);
const sampleNumbers = new Map([["rate", 0.1]]);

/** Example value for a rule input or source parameter: its default, else a typed placeholder. */
export function sampleValue(parameter: Input): unknown {
  if (parameter.defaultValue != null) return parameter.defaultValue;
  switch (parameter.type) {
    case "NUMBER":
      return sampleNumbers.get(parameter.name) ?? 150;
    case "STRING":
      return sampleTexts.get(parameter.name) ?? "example";
    case "BOOLEAN":
      return true;
    case "ARRAY":
      return [];
    case "OBJECT":
      return {};
  }
}

/** Example inputs: required or defaulted inputs that no data source supplies. */
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

/** The example inputs as an editable JSON buffer, keeping every digit of big defaults. */
export function sampleInputsJson(definition: Definition): string {
  return stringifyJson(sampleInputs(definition), 2);
}

/** Input text the user typed for one execution target, such as a rule version. */
export interface EditedInputs {
  target: string;
  text: string;
}

/**
 * The input buffer shown for `target`: the text typed for it, otherwise the
 * current sample. An untouched buffer follows input changes; an edit never
 * moves to another target.
 */
export function shownInputs(
  edited: EditedInputs | null,
  target: string,
  sample: string,
): string {
  return edited?.target === target ? edited.text : sample;
}

/** Reads an input buffer without rounding numbers; anything but a JSON object throws. */
export function parseExecutionInputs(text: string): Record<string, unknown> {
  return parseJsonObject(text, "Inputs must be a JSON object.");
}

/** The inputs a buffer holds, or null while it is not a JSON object (for previews such as cURL). */
export function tryParseExecutionInputs(
  text: string,
): Record<string, unknown> | null {
  try {
    return parseExecutionInputs(text);
  } catch {
    return null;
  }
}

/** Quotes text as one POSIX shell word. */
const shellWord = (text: string) => `'${text.replace(/'/g, "'\\''")}'`;

/**
 * A copyable cURL command for a rule's execute endpoint (see ruleApi.executeUrl).
 * The request body always carries an inputs object: null, or any other value that
 * is not a JSON object, is shown as {}, as for a buffer that is still being edited.
 */
export function curlExample(
  endpoint: string,
  inputs: Record<string, unknown> | null,
  version?: number | null,
  options: ExecutionOptions = {},
): string {
  const body = stringifyJson(
    {
      inputs: isJsonObject(inputs) ? inputs : {},
      ...(version ? { version } : {}),
      ...options,
    },
    2,
  );
  return `curl -X POST ${shellWord(endpoint)} \\\n  -H 'Content-Type: application/json' \\\n  -d ${shellWord(body)}`;
}
