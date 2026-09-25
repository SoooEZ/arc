import type {
  Build,
  Definition,
  Execution,
  ExecutionOptions,
  FunctionEntry,
} from "../types";
import type { GraphProblem } from "./errors";
import { http, type RequestOptions } from "./http";
export const studioApi = {
  checkExpression: (expression: string, options?: RequestOptions) =>
    http.post<{ valid: boolean; variables: string[]; error: string | null }>(
      "/studio/expression/check",
      { expression },
      options,
    ),
  diagnostics: (definition: Definition, options?: RequestOptions) =>
    http.post<GraphProblem[]>("/diagnostics", definition, options),
  variables: (definition: Definition, options?: RequestOptions) =>
    http.post<Record<string, string[]>>("/variables", definition, options),
  validate: (definition: Definition) =>
    http.post<{ valid: boolean }>("/validate", definition),
  preview: (
    definition: Definition,
    inputs: Record<string, unknown>,
    options?: RequestOptions & ExecutionOptions,
  ) =>
    http.post<Execution>(
      "/preview",
      {
        definition,
        inputs,
        trace: options?.trace,
        timeoutMs: options?.timeoutMs,
      },
      options,
    ),
  functions: (options?: RequestOptions) =>
    http.get<FunctionEntry[]>("/functions", options),
  render: (definition: Definition, options?: RequestOptions) =>
    http.post<{ source: string }>("/studio/render", definition, options),
  build: (source: string) => http.post<Build>("/studio/build", { source }),
  renderNode: (
    definition: Definition,
    nodeId: string,
    options?: RequestOptions,
  ) =>
    http.post<{ source: string }>(
      "/studio/node/render",
      { definition, nodeId },
      options,
    ),
  buildNode: (
    definition: Definition,
    nodeId: string,
    source: string,
    options?: RequestOptions,
  ) =>
    http.post<Build>(
      "/studio/node/build",
      { definition, nodeId, source },
      options,
    ),
};
