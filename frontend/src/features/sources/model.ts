import type { DataSource, Input, SourceConfig } from "../../types";

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
  return {
    ...source,
    definition: {
      ...source.definition,
      parameters: JSON.parse(buffers.parameters),
      entries: JSON.parse(buffers.entries),
      secretHeaders: JSON.parse(buffers.secretHeaders),
    },
  };
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
