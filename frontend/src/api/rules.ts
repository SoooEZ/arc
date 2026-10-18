import type {
  Definition,
  Execution,
  ExecutionOptions,
  Kind,
  Rule,
  RuleCaller,
  RuleDuplicate,
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
  /**
   * One rule's catalog item without its draft: its current name, kind,
   * publication and incarnation.
   */
  summary: (id: string, options?: RequestOptions) =>
    http.get<RuleSummary>(`/rule-summaries/${pathId(id)}`, options),
  get: (id: string, options?: RequestOptions) =>
    http.get<Rule>(`/rules/${pathId(id)}`, options),
  /** Creates a rule from its kind's template, or with `definition` as its draft. */
  create: (
    id: string,
    name: string,
    description: string,
    kind: Kind,
    definition?: Definition,
    options?: RequestOptions,
  ) =>
    http.post<Rule>(
      "/rules",
      { id, name, description, kind, definition },
      options,
    ),
  /** A new rule with another rule's saved draft or published version, and its saved tests. */
  duplicate: (id: string, copy: RuleDuplicate, options?: RequestOptions) =>
    http.post<Rule>(`/rules/${pathId(id)}/duplicate`, copy, options),
  /** The rules whose draft or published versions call this rule, by rule ID. */
  callers: (
    id: string,
    query: { offset?: number; limit?: number } = {},
    options?: RequestOptions,
  ) =>
    http.get<Page<RuleCaller>>(
      `/rules/${pathId(id)}/callers?${queryString(query)}`,
      options,
    ),
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
  /** Publishes the draft at `revision` as the next version, with an optional note about it. */
  publish: (
    id: string,
    revision: number,
    note: string | null,
    options?: RequestOptions,
  ) =>
    http.post<Rule>(
      `/rules/${pathId(id)}/publish`,
      { revision, note },
      options,
    ),
  /**
   * Deletes the draft and every published version of the rule at `revision`. A 409
   * names the rules that still call it, or reports that the rule changed since.
   */
  delete: (id: string, revision: number, options?: RequestOptions) =>
    http.delete<void>(`/rules/${pathId(id)}?revision=${revision}`, options),
  /**
   * Execution options go into the body whole, so a new option reaches the
   * server as it reaches the cURL example; request options stay apart.
   */
  execute: (
    id: string,
    inputs: Record<string, unknown>,
    version?: number,
    execution?: ExecutionOptions,
    options?: RequestOptions,
  ) =>
    http.post<Execution>(
      executePath(id),
      { inputs, version, ...execution },
      options,
    ),
  /** The execute endpoint as an absolute URL, for copyable examples such as cURL. */
  executeUrl: (id: string, origin: string = window.location.origin) =>
    new URL(http.url(executePath(id)), origin).href,
  version: (id: string, version: number, options?: RequestOptions) =>
    http.get<Version>(`/rules/${pathId(id)}/versions/${version}`, options),
};
