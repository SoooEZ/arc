import { expect, test } from "@playwright/test";
import { loadFunctionCatalog } from "../../src/features/studio/useFunctionCatalog";

const catalog = [
  {
    name: "$ROUND",
    category: "Math",
    signature: "$ROUND(value, digits)",
    description: "Rounds a number.",
    snippet: "\\$ROUND(${1:value}, ${2:0})",
    supported: true,
    origin: "ARC",
  },
];

test("editors share one function catalog read and retry after a failed read", async () => {
  const realFetch = globalThis.fetch;
  const requests: string[] = [];
  let available = false;
  globalThis.fetch = async (input) => {
    requests.push(String(input));
    return available
      ? new Response(JSON.stringify(catalog), { status: 200 })
      : new Response("unavailable", { status: 503 });
  };
  try {
    const failed = await Promise.allSettled([
      loadFunctionCatalog(),
      loadFunctionCatalog(),
    ]);
    expect(failed.map((result) => result.status)).toEqual([
      "rejected",
      "rejected",
    ]);
    expect(requests).toEqual(["/api/functions"]);

    available = true;
    const [first, second] = await Promise.all([
      loadFunctionCatalog(),
      loadFunctionCatalog(),
    ]);
    expect(first).toEqual(catalog);
    expect(second).toBe(first);
    expect(await loadFunctionCatalog()).toBe(first);
    expect(requests).toEqual(["/api/functions", "/api/functions"]);
  } finally {
    globalThis.fetch = realFetch;
  }
});
