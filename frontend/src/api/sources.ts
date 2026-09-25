import type {
  DataSource,
  SourceConfig,
  SourceSummary,
  SourceVersionSummary,
  Page,
} from "../types";
import { http, pathId, type RequestOptions } from "./http";
export const sourceApi = {
  catalog: (
    query: { offset?: number; limit?: number; search?: string } = {},
    options?: RequestOptions,
  ) =>
    http.get<Page<SourceSummary>>(
      `/source-summaries?${new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)]))}`,
      options,
    ),
  versionSummaries: (
    id: string,
    query: { offset?: number; limit?: number } = {},
    options?: RequestOptions,
  ) =>
    http.get<Page<SourceVersionSummary>>(
      `/sources/${pathId(id)}/version-summaries?${new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)]))}`,
      options,
    ),
  source: (id: string, version: number, options?: RequestOptions) =>
    http.get<DataSource>(`/sources/${pathId(id)}/versions/${version}`, options),
  createSource: (id: string, name: string, definition: SourceConfig) =>
    http.post<DataSource>("/sources", { id, name, definition }),
  saveSource: (source: DataSource) =>
    http.put<DataSource>(`/sources/${pathId(source.id)}`, {
      name: source.name,
      revision: source.version,
      definition: source.definition,
    }),
  testSource: (id: string, version: number, inputs: Record<string, unknown>) =>
    http.post<{ result: unknown }>(`/sources/${pathId(id)}/test`, {
      version,
      inputs,
    }),
};
