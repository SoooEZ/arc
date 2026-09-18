import { test, expect } from "@playwright/test";
import { createHttpClient, pathId } from "../../src/api/http";
import { ApiError } from "../../src/api/errors";

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
