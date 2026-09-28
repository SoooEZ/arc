import { test, expect } from "@playwright/test";
import { createHttpClient, pathId } from "../../src/api/http";
import { ApiError } from "../../src/api/errors";
import { ruleApi } from "../../src/api/rules";

/** A body that delivers part of a document and then fails, like a reset connection. */
function failingBody(failure: Error) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"revision":'));
      controller.error(failure);
    },
  });
}

test("transport preserves method, typed payload and abort signal", async () => {
  const calls: { url: string; options?: RequestInit }[] = [];
  const fetcher: typeof fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return new Response(JSON.stringify({ revision: 2 }), { status: 200 });
  };
  const controller = new AbortController();
  const client = createHttpClient("/api", fetcher);
  expect(
    await client.put(
      "/rules/example",
      { revision: 1, enabled: false },
      { signal: controller.signal },
    ),
  ).toEqual({ revision: 2 });
  expect(calls[0].url).toBe("/api/rules/example");
  expect(calls[0].options?.method).toBe("PUT");
  expect(JSON.parse(calls[0].options?.body as string)).toEqual({
    revision: 1,
    enabled: false,
  });
  expect(calls[0].options?.signal).toBe(controller.signal);
  expect(pathId("a/b?x=1")).toBe("a%2Fb%3Fx%3D1");
});

test("numbers a double cannot represent round-trip from a response to the next request", async () => {
  const draft =
    '{"inputs":[{"name":"id","type":"NUMBER","required":true,"defaultValue":9007199254740993},{"name":"rate","type":"NUMBER","required":false,"defaultValue":0.12345678901234567890123}],"entries":{"US":{"accountId":12345678901234567890,"limit":1e400}}}';
  const bodies: string[] = [];
  const client = createHttpClient("/api", async (_url, options) => {
    if (options?.body !== undefined) bodies.push(String(options.body));
    return new Response(draft, { status: 200 });
  });
  const loaded = await client.get<unknown>("/rules/example");
  await client.put("/rules/example", loaded);
  expect(bodies).toEqual([draft]);
});

test("API errors retain graph locations and status; non-JSON errors still explain failure", async () => {
  const location = {
    ruleId: "child",
    version: 2,
    nodeId: "bad",
    label: "Invalid",
  };
  const client = createHttpClient(
    "/api",
    async () =>
      new Response(
        JSON.stringify({
          message: "Invalid expression",
          locations: [location],
        }),
        { status: 422 },
      ),
  );
  const error = await client.get("/rules/example").catch((error) => error);
  expect(error).toBeInstanceOf(ApiError);
  expect(error).toMatchObject({
    status: 422,
    message: "Invalid expression",
    locations: [location],
  });
  const offline = createHttpClient(
    "/api",
    async () => new Response("upstream unavailable", { status: 503 }),
  );
  await expect(offline.get("/rules")).rejects.toMatchObject({
    message: "Request failed (503)",
    status: 503,
  });
});

test("a successful response without a readable JSON document rejects instead of resolving null", async () => {
  const responses: Record<string, () => Response> = {
    "proxy page": () =>
      new Response("<!doctype html><title>Sign in</title>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    "empty body": () => new Response("", { status: 200 }),
    "truncated document": () => new Response('{"revision":', { status: 201 }),
    "reset connection": () =>
      new Response(failingBody(new TypeError("terminated")), { status: 200 }),
  };
  for (const [name, response] of Object.entries(responses)) {
    const client = createHttpClient("/api", async () => response());
    const failure = await client
      .put("/rules/example", { revision: 1 })
      .catch((error: unknown) => error);
    expect(failure, name).toBeInstanceOf(ApiError);
    expect(failure, name).toMatchObject({
      status: response().status,
      locations: [],
      message: `The server response could not be read (${response().status}). Check your connection and try again.`,
    });
  }
});

test("no-content responses still resolve, and cancelled body reads keep their abort error", async () => {
  for (const status of [204, 205]) {
    const client = createHttpClient(
      "/api",
      async () => new Response(null, { status }),
    );
    expect(await client.post("/rules/example/publish", {}), `${status}`).toBe(
      undefined,
    );
  }
  const controller = new AbortController();
  const aborted = new DOMException(
    "The editor session has closed",
    "AbortError",
  );
  const client = createHttpClient("/api", async () => {
    controller.abort();
    return new Response(failingBody(aborted), { status: 200 });
  });
  await expect(
    client.get("/rules/example", { signal: controller.signal }),
  ).rejects.toBe(aborted);
});

test("resource URLs share the client's base and encode rule IDs", () => {
  expect(createHttpClient("/base").url("/rules")).toBe("/base/rules");
  expect(ruleApi.executeUrl("pricing", "https://arc.example")).toBe(
    "https://arc.example/api/rules/pricing/execute",
  );
  expect(ruleApi.executeUrl("a/b c?", "http://localhost:3080")).toBe(
    "http://localhost:3080/api/rules/a%2Fb%20c%3F/execute",
  );
});
