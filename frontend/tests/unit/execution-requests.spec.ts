import { expect, test } from "@playwright/test";
import { ruleApi } from "../../src/api/rules";
import { studioApi } from "../../src/api/studio";
import type { Definition, ExecutionOptions } from "../../src/types";

const definition: Definition = {
  schemaVersion: 1,
  inputs: [],
  nodes: [],
  edges: [],
};

// The requests copied trace and timeoutMs by name while the cURL example
// spread every option, so a new option would have reached only the example.
test("every execution option reaches the request body, and request options stay out of it", async () => {
  const bodies: unknown[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    return new Response("{}", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  try {
    const { signal } = new AbortController();
    const later = { trace: false, timeoutMs: 5000, explain: true };
    await ruleApi.execute("tax", { amount: 1 }, 2, later as ExecutionOptions, {
      signal,
    });
    await studioApi.preview(
      definition,
      {},
      { trace: true, timeoutMs: 1000 },
      { signal },
    );
  } finally {
    globalThis.fetch = original;
  }
  expect(bodies).toEqual([
    {
      inputs: { amount: 1 },
      version: 2,
      trace: false,
      timeoutMs: 5000,
      explain: true,
    },
    { definition, inputs: {}, trace: true, timeoutMs: 1000 },
  ]);
});
