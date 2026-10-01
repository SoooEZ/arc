import { expect, test } from "@playwright/test";
import {
  pendingResourceState,
  resourceStateFor,
} from "../../src/hooks/useAsyncResource";

const loaded = {
  key: "a",
  enabled: true,
  data: ["row"],
  error: "",
  status: null,
  loading: false,
};

test("a read start stores nothing the render already derives, so a key change costs one render", () => {
  // The effect stored a fresh loading object on every key change and on mount, and every
  // consumer committed a second full render per keystroke.
  // The mount stored `initial` itself, so the pending view holds the same array.
  const initial: string[] = [];
  const options = { key: "b", enabled: true, keepData: false, initial };
  expect(pendingResourceState(loaded, options)).toBe(loaded);
  const mounted = { ...loaded, key: "b", data: initial, loading: true };
  expect(pendingResourceState(mounted, options)).toBe(mounted);
  expect(pendingResourceState(loaded, { ...options, enabled: false })).toBe(
    loaded,
  );
});

test("the same key stores a new loading state after a completed read or when enabled flips", () => {
  const again = pendingResourceState(loaded, {
    key: "a",
    enabled: true,
    keepData: false,
    initial: [],
  });
  expect(again).not.toBe(loaded);
  expect(again).toEqual({ ...loaded, data: [], loading: true });
  const kept = pendingResourceState(loaded, {
    key: "a",
    enabled: true,
    keepData: true,
    initial: [],
  });
  expect(kept).toEqual({ ...loaded, loading: true });
  const disabled = { ...loaded, enabled: false, loading: false };
  expect(
    pendingResourceState(disabled, {
      key: "a",
      enabled: false,
      keepData: false,
      initial: [],
    }),
  ).toEqual({ ...disabled, data: [] });
  const failed = { ...loaded, error: "boom", status: 500 };
  expect(
    pendingResourceState(failed, {
      key: "a",
      enabled: true,
      keepData: false,
      initial: [],
    }),
  ).toEqual({ ...loaded, data: [], loading: true });
});

test("returning to a key before the new read finishes shows it loading, not its earlier answer", () => {
  // The earlier answer stayed stored while another key loaded, so going back
  // mounted a deleted rule's editor or flashed a stale "not found" for a commit.
  const initial: string[] = [];
  const options = { enabled: true, keepData: false, initial };
  const toB = resourceStateFor(loaded, { ...options, key: "b" });
  expect(toB).toEqual({ ...loaded, key: "b", data: initial, loading: true });
  const backToA = resourceStateFor(toB, { ...options, key: "a" });
  expect(backToA).toEqual({ ...loaded, data: initial, loading: true });
  expect(resourceStateFor(loaded, { ...options, key: "a" })).toBe(loaded);
  // keepPrevious keeps showing the rows it has while the next key loads.
  expect(
    resourceStateFor(loaded, { ...options, key: "b", keepData: true }),
  ).toEqual({ ...loaded, key: "b", loading: true });
});
