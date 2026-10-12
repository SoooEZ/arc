import { expect, test } from "@playwright/test";
import { useKeyedValue } from "../../src/hooks/useKeyedValue";
import { renderHook } from "../helpers/hookHost";

type Props = { value: { n: number }; key: string };

test("a value keeps its identity while its key is unchanged and follows a new key", async () => {
  const first = { n: 1 };
  const host = await renderHook(
    ({ value, key }: Props) => useKeyedValue(value, key),
    { value: first, key: "a" },
  );
  expect(host.current).toBe(first);
  // A new object with the same key is the same content: the first object stays.
  await host.rerender({ value: { n: 1 }, key: "a" });
  expect(host.current).toBe(first);
  // A new key adopts its value in the same render, with no stale value in between.
  const second = { n: 2 };
  await host.rerender({ value: second, key: "b" });
  expect(host.current).toBe(second);
  await host.rerender({ value: { n: 2 }, key: "b" });
  expect(host.current).toBe(second);
  await host.unmount();
});
