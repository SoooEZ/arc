import {
  expect,
  type APIRequestContext,
  type APIResponse,
} from "@playwright/test";
import type {
  DataSource,
  Definition,
  Kind,
  Rule,
  SourceConfig,
} from "../../src/types";

/** A short text unique to this run, for IDs and names that must not collide across runs. */
export function uniqueStamp(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** A rule or source ID unique to this run, within the 80-character slug policy. */
export function uniqueId(prefix: string): string {
  return `${prefix}-${uniqueStamp()}`.slice(0, 80);
}

/** Posts a rule creation (any object, or a raw JSON body) and returns the response, for tests that expect a refusal. */
export function createRuleResponse(
  request: APIRequestContext,
  creation: object | string,
): Promise<APIResponse> {
  return typeof creation === "string"
    ? request.post("/api/rules", {
        headers: { "Content-Type": "application/json" },
        data: creation,
      })
    : request.post("/api/rules", { data: creation });
}

/** The smallest complete graph: the Input node returns `amount`. */
export const inputToOutput: Definition = {
  schemaVersion: 1,
  inputs: [
    { name: "amount", type: "NUMBER", required: true, defaultValue: 10 },
  ],
  nodes: [
    { id: "input", type: "INPUT", label: "Inputs", position: { x: 0, y: 0 } },
    {
      id: "out",
      type: "OUTPUT",
      label: "Result",
      expression: "amount",
      position: { x: 0, y: 200 },
    },
  ],
  edges: [{ id: "next", source: "input", target: "out", sourceHandle: "next" }],
};

/** Creates a rule through the API; the response text explains a refusal. */
export async function createRule(
  request: APIRequestContext,
  {
    id = uniqueId("rule"),
    name = id,
    kind = "FORMULA",
    description = "",
    definition,
  }: {
    id?: string;
    name?: string;
    kind?: Kind;
    description?: string;
    /** Omitted: the server's template for the kind. */
    definition?: Definition;
  } = {},
): Promise<Rule> {
  const response = await createRuleResponse(request, {
    id,
    name,
    kind,
    description,
    definition,
  });
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()) as Rule;
}

/** Posts a publication and returns the response, for tests that expect a refusal. */
export function publishRuleResponse(
  request: APIRequestContext,
  rule: Pick<Rule, "id" | "revision">,
): Promise<APIResponse> {
  return request.post(`/api/rules/${rule.id}/publish`, {
    data: { revision: rule.revision },
  });
}

/** Publishes the rule's current draft at the revision the rule carries. */
export async function publishRule(
  request: APIRequestContext,
  rule: Pick<Rule, "id" | "revision">,
): Promise<Rule> {
  const response = await publishRuleResponse(request, rule);
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()) as Rule;
}

/** The rule as the server holds it now. */
export async function readRule(
  request: APIRequestContext,
  id: string,
): Promise<Rule> {
  const response = await request.get(`/api/rules/${id}`);
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()) as Rule;
}

export async function createSource(
  request: APIRequestContext,
  {
    id = uniqueId("source"),
    name = id,
    definition,
  }: { id?: string; name?: string; definition: SourceConfig },
): Promise<DataSource> {
  const response = await request.post("/api/sources", {
    data: { id, name, definition },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()) as DataSource;
}

/** Deletes a rule, whatever its revision: cleanup, or a fixture created again under its ID. */
export async function deleteRule(
  request: APIRequestContext,
  id: string,
): Promise<void> {
  const response = await request.delete(`/api/rules/${id}`);
  expect(response.status(), await response.text()).toBe(204);
}
