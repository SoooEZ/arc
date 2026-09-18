import type { DataSource, SourceConfig } from "../types";
import { http, pathId, type RequestOptions } from "./http";
export const sourceApi = {
  sources: (options?: RequestOptions) =>
    http.get<DataSource[]>("/sources", options),
  sourceVersions: (id: string, options?: RequestOptions) =>
    http.get<DataSource[]>(`/sources/${pathId(id)}/versions`, options),
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
