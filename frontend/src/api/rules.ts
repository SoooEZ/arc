import type { Execution, Kind, Rule, Version } from "../types";
import { http, pathId, type RequestOptions } from "./http";
export const ruleApi = {
  list: (options?: RequestOptions) => http.get<Rule[]>("/rules", options),
  get: (id: string, options?: RequestOptions) =>
    http.get<Rule>(`/rules/${pathId(id)}`, options),
  create: (id: string, name: string, description: string, kind: Kind) =>
    http.post<Rule>("/rules", { id, name, description, kind }),
  save: (rule: Rule) =>
    http.put<Rule>(`/rules/${pathId(rule.id)}`, {
      name: rule.name,
      description: rule.description,
      revision: rule.revision,
      definition: rule.draft,
    }),
  publish: (id: string, revision: number) =>
    http.post<Rule>(`/rules/${pathId(id)}/publish`, { revision }),
  execute: (
    id: string,
    inputs: Record<string, unknown>,
    version?: number,
    options?: RequestOptions,
  ) =>
    http.post<Execution>(
      `/rules/${pathId(id)}/execute`,
      { inputs, version },
      options,
    ),
  versions: (id: string, options?: RequestOptions) =>
    http.get<Version[]>(`/rules/${pathId(id)}/versions`, options),
  version: (id: string, version: number, options?: RequestOptions) =>
    http.get<Version>(`/rules/${pathId(id)}/versions/${version}`, options),
};
