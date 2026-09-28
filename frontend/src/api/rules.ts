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
import { http, pathId, queryString, type RequestOptions } from "./http";
// A type alias, not an interface: only aliases satisfy queryString's index signature.
export type RuleCatalogQuery = {
  offset?: number;
  limit?: number;
  search?: string;
  kind?: Kind | "";
  publishedOnly?: boolean;
};
const executePath = (id: string) => `/rules/${pathId(id)}/execute`;
export const ruleApi = {
  catalog: (query: RuleCatalogQuery = {}, options?: RequestOptions) =>
    http.get<Page<RuleSummary>>(
      `/rule-summaries?${queryString(query)}`,
      options,
    ),
  versionSummaries: (
    id: string,
    query: { offset?: number; limit?: number; search?: string } = {},
    options?: RequestOptions,
  ) =>
    http.get<Page<VersionSummary>>(
      `/rules/${pathId(id)}/version-summaries?${queryString(query)}`,
      options,
    ),
  get: (id: string, options?: RequestOptions) =>
    http.get<Rule>(`/rules/${pathId(id)}`, options),
  create: (
    id: string,
    name: string,
    description: string,
    kind: Kind,
    options?: RequestOptions,
  ) => http.post<Rule>("/rules", { id, name, description, kind }, options),
  save: (rule: Rule, options?: RequestOptions) =>
    http.put<Rule>(
      `/rules/${pathId(rule.id)}`,
      {
        name: rule.name,
        description: rule.description,
        revision: rule.revision,
        definition: rule.draft,
      },
      options,
    ),
  publish: (id: string, revision: number, options?: RequestOptions) =>
    http.post<Rule>(`/rules/${pathId(id)}/publish`, { revision }, options),
  /**
   * Deletes the draft and every published version of the rule at `revision`. A 409
   * names the rules that still call it, or reports that the rule changed since.
   */
  delete: (id: string, revision: number, options?: RequestOptions) =>
    http.delete<void>(`/rules/${pathId(id)}?revision=${revision}`, options),
  execute: (
    id: string,
    inputs: Record<string, unknown>,
    version?: number,
    options?: RequestOptions & ExecutionOptions,
  ) =>
    http.post<Execution>(
      executePath(id),
      { inputs, version, trace: options?.trace, timeoutMs: options?.timeoutMs },
      options,
    ),
  /** The execute endpoint as an absolute URL, for copyable examples such as cURL. */
  executeUrl: (id: string, origin: string = window.location.origin) =>
    new URL(http.url(executePath(id)), origin).href,
  version: (id: string, version: number, options?: RequestOptions) =>
    http.get<Version>(`/rules/${pathId(id)}/versions/${version}`, options),
};
