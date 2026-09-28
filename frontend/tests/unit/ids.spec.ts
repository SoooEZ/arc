import { expect, test } from "@playwright/test";
import { newId, shortId, uniqueName } from "../../src/domain/ids";

const uuidV4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test("IDs do not need crypto.randomUUID, which insecure origins lack", () => {
  // Plain-HTTP origins other than localhost expose getRandomValues but not randomUUID.
  Object.defineProperty(crypto, "randomUUID", {
    value: undefined,
    configurable: true,
  });
  try {
    const ids = Array.from({ length: 200 }, () => newId());
    for (const id of ids) expect(id).toMatch(uuidV4);
    expect(new Set(ids).size).toBe(ids.length);
    expect(shortId("node-")).toMatch(/^node-[0-9a-f]{8}$/);
  } finally {
    Reflect.deleteProperty(crypto, "randomUUID");
  }
  expect(typeof crypto.randomUUID).toBe("function");
});

test("short IDs append the requested number of random hex digits", () => {
  expect(shortId("case-")).toMatch(/^case-[0-9a-f]{8}$/);
  expect(shortId("edge-", 3)).toMatch(/^edge-[0-9a-f]{3}$/);
  expect(shortId("", 12)).toMatch(/^[0-9a-f]{12}$/);
  const ids = new Set(Array.from({ length: 200 }, () => shortId("node-")));
  expect(ids.size).toBe(200);
  for (const length of [0, -1, 1.5, Number.NaN])
    expect(() => shortId("node-", length), String(length)).toThrow(RangeError);
});

test("unique names take the first free suffix from the start value", () => {
  expect(uniqueName("result_", [])).toBe("result_1");
  expect(uniqueName("result_", ["result_1", "result_2", "result_4"])).toBe(
    "result_3",
  );
  expect(uniqueName("field_", new Set(["field_3"]), 3)).toBe("field_4");
  expect(uniqueName("input", ["input1", "result_1"])).toBe("input2");
});
