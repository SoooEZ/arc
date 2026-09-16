import type { Definition, Execution, Kind, Rule, Version } from "./types";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(body?.message || `Request failed (${response.status})`);
  return body as T;
}
const post = (body: unknown) => ({
  method: "POST",
  body: JSON.stringify(body),
});
export const api = {
  list: () => request<Rule[]>("/rules"),
  get: (id: string) => request<Rule>(`/rules/${encodeURIComponent(id)}`),
  create: (id: string, name: string, description: string, kind: Kind) =>
    request<Rule>("/rules", post({ id, name, description, kind })),
  save: (r: Rule) =>
    request<Rule>(`/rules/${r.id}`, {
      method: "PUT",
      body: JSON.stringify({
        name: r.name,
        description: r.description,
        revision: r.revision,
        definition: r.draft,
      }),
    }),
  publish: (id: string, revision: number) =>
    request<Rule>(`/rules/${id}/publish`, post({ revision })),
  validate: (definition: Definition) =>
    request<{ valid: boolean }>("/validate", post(definition)),
  preview: (definition: Definition, inputs: Record<string, unknown>) =>
    request<Execution>("/preview", post({ definition, inputs })),
  execute: (id: string, inputs: Record<string, unknown>, version?: number) =>
    request<Execution>(`/rules/${id}/execute`, post({ inputs, version })),
  versions: (id: string) => request<Version[]>(`/rules/${id}/versions`),
  version: (id: string, version: number) =>
    request<Version>(`/rules/${id}/versions/${version}`),
};
export function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
}
