import type { DataSource, Input, SourceConfig } from "../../types";
import { parameterNameError } from "../../domain/identifiers";

export interface SourceBuffers {
  parameters: string;
  entries: string;
  secretHeaders: string;
}

export function sourceBuffers(config: SourceConfig): SourceBuffers {
  return {
    parameters: JSON.stringify(config.parameters, null, 2),
    entries: JSON.stringify(config.entries ?? {}, null, 2),
    secretHeaders: JSON.stringify(config.secretHeaders ?? {}, null, 2),
  };
}

export function sourceCandidate(
  source: DataSource,
  buffers: SourceBuffers,
): DataSource {
  const parameters: unknown = JSON.parse(buffers.parameters);
  const namesError = sourceParameterNamesError(parameters);
  if (namesError) throw new Error(namesError);
  return {
    ...source,
    definition: {
      ...source.definition,
      parameters: parameters as Input[],
      entries: JSON.parse(buffers.entries),
      secretHeaders: JSON.parse(buffers.secretHeaders),
    },
  };
}

export function sourceParameterNamesError(parameters: unknown): string | null {
  if (!Array.isArray(parameters))
    return "Source parameters must be a JSON array.";
  for (const [index, parameter] of parameters.entries()) {
    const error = parameterNameError(parameter?.name);
    if (error) return `Parameter ${index + 1}: ${error}`;
  }
  return null;
}

export function sourceParameterBufferError(text: string): string | null {
  try {
    return sourceParameterNamesError(JSON.parse(text));
  } catch {
    return "Enter valid JSON before saving source parameters.";
  }
}

function sampleValue(parameter: Input): unknown {
  if (parameter.defaultValue != null) return parameter.defaultValue;
  switch (parameter.type) {
    case "NUMBER":
      return 1;
    case "BOOLEAN":
      return true;
    case "ARRAY":
      return [];
    case "OBJECT":
      return {};
    case "STRING":
      return parameter.name === "key" ? "US" : "example";
  }
}

export function sourceSample(config: SourceConfig): string {
  const values = Object.fromEntries(
    config.parameters.map((parameter) => [
      parameter.name,
      sampleValue(parameter),
    ]),
  );
  return JSON.stringify(values, null, 2);
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
