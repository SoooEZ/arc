import type {
  Execution,
  ExecutionOptions,
  Kind,
  Rule,
  Version,
  Page,
  RuleSummary,
  VersionSummary,
} from "../types";
import { http, pathId, type RequestOptions } from "./http";
export interface RuleCatalogQuery {
  offset?: number;
  limit?: number;
  search?: string;
  kind?: Kind | "";
  publishedOnly?: boolean;
}
export const ruleApi = {
  catalog: (query: RuleCatalogQuery = {}, options?: RequestOptions) =>
    http.get<Page<RuleSummary>>(
      `/rule-summaries?${new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)]))}`,
      options,
    ),
  versionSummaries: (
    id: string,
    query: { offset?: number; limit?: number; search?: string } = {},
    options?: RequestOptions,
  ) =>
    http.get<Page<VersionSummary>>(
      `/rules/${pathId(id)}/version-summaries?${new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)]))}`,
      options,
    ),
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
    options?: RequestOptions & ExecutionOptions,
  ) =>
    http.post<Execution>(
      `/rules/${pathId(id)}/execute`,
      { inputs, version, trace: options?.trace, timeoutMs: options?.timeoutMs },
      options,
    ),
  version: (id: string, version: number, options?: RequestOptions) =>
    http.get<Version>(`/rules/${pathId(id)}/versions/${version}`, options),
};
