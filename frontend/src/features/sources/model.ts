import type { DataSource, Input, SourceConfig } from "../../types";
import { identifierError } from "../../domain/identifiers";
import { sampleValue } from "../../domain/executionInputs";
import { parseJson, parseJsonObject, stringifyJson } from "../../domain/json";
import { sourceProviders } from "./sourceProviders";

/**
 * Raw JSON text for the editable parts of a source. Buffers keep every digit of
 * the saved configuration, e.g. lookup entries such as 12345678901234567890.
 */
export interface SourceBuffers {
  parameters: string;
  entries: string;
  secretHeaders: string;
}

export function sourceBuffers(config: SourceConfig): SourceBuffers {
  return {
    parameters: stringifyJson(config.parameters, 2),
    entries: stringifyJson(config.entries ?? {}, 2),
    secretHeaders: stringifyJson(config.secretHeaders ?? {}, 2),
  };
}

export function sourceCandidate(
  source: DataSource,
  buffers: SourceBuffers,
): DataSource {
  const parameters = parseJson(buffers.parameters);
  const namesError = sourceParameterNamesError(parameters);
  if (namesError) throw new Error(namesError);
  const {
    entries: _entries,
    secretHeaders: _secretHeaders,
    url,
    ...configuration
  } = source.definition;
  // Only the active provider's fields are sent: the others' buffers stay as typed.
  return {
    ...source,
    definition: {
      ...configuration,
      parameters: parameters as Input[],
      ...sourceProviders[configuration.kind].activeFields(
        { ...configuration, url },
        buffers,
      ),
    },
  };
}

export function sourceParameterNamesError(parameters: unknown): string | null {
  if (!Array.isArray(parameters))
    return "Source parameters must be a JSON array.";
  for (const [index, parameter] of parameters.entries()) {
    const error = identifierError(parameter?.name);
    if (error) return `Parameter ${index + 1}: ${error}`;
  }
  return null;
}

export function sourceParameterBufferError(text: string): string | null {
  try {
    return sourceParameterNamesError(parseJson(text));
  } catch {
    return "Enter valid JSON before saving source parameters.";
  }
}

/** Example test parameters. Source parameters are scalar: the server rejects ARRAY and OBJECT. */
export function sourceSample(config: SourceConfig): string {
  const values = Object.fromEntries(
    config.parameters.map((parameter) => [
      parameter.name,
      sampleValue(parameter),
    ]),
  );
  return stringifyJson(values, 2);
}

/** Reads the source test buffer without rounding numbers. */
export function parseSourceTestInputs(text: string): Record<string, unknown> {
  return parseJsonObject(text, "Test parameters must be a JSON object.");
}

/** The parameter a provider starts with when it is first chosen for a source. */
export function providerParameterTemplate(kind: SourceConfig["kind"]): Input[] {
  return [
    {
      name: sourceProviders[kind].starterParameter,
      type: "STRING",
      required: true,
      defaultValue: null,
    },
  ];
}

export const createSourceDraft = (): DataSource => ({
  id: "",
  name: "",
  version: 0,
  definition: {
    kind: "LOOKUP",
    parameters: [
      { name: "key", type: "STRING", required: true, defaultValue: null },
    ],
    entries: { US: { rate: 0.07 }, GB: { rate: 0.2 } },
    timeoutMs: 3000,
  },
});
