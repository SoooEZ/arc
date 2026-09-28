import { expect, test } from "@playwright/test";
import { PinnedReads } from "../../src/features/studio/pinnedReads";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test("concurrent loads of one pin share a request, and an aborting subscriber leaves it to the others", async () => {
  // Five cards bound to one source sent five identical reads on mount.
  const reads = new PinnedReads<string>();
  let started = 0;
  const pending = deferred<string>();
  let readSignal: AbortSignal | null = null;
  const read = (signal: AbortSignal) => {
    started += 1;
    readSignal = signal;
    return pending.promise;
  };
  const first = new AbortController();
  const a = reads.load("s:1", read, first.signal);
  const b = reads.load("s:1", read);
  expect(started).toBe(1);
  first.abort();
  await expect(a).rejects.toThrow();
  expect(readSignal!.aborted).toBe(false);
  pending.resolve("v1");
  expect(await b).toBe("v1");
  expect(await reads.load("s:1", read)).toBe("v1");
  expect(started).toBe(1);
});

test("a read aborted by every subscriber is not cached, and forget drops every version of an ID", async () => {
  const reads = new PinnedReads<string>(2);
  const aborted = deferred<string>();
  const controller = new AbortController();
  const load = reads.load(
    "s:1",
    (signal) => {
      signal.addEventListener("abort", () =>
        aborted.reject(new DOMException("aborted", "AbortError")),
      );
      return aborted.promise;
    },
    controller.signal,
  );
  controller.abort();
  await expect(load).rejects.toThrow();
  let started = 0;
  const fresh = (value: string) => async () => {
    started += 1;
    return value;
  };
  expect(await reads.load("s:1", fresh("v1"))).toBe("v1");
  expect(started).toBe(1);
  await reads.load("s:2", fresh("v2"));
  await reads.load("t:1", fresh("t1"));
  // Capacity 2: s:1, the least recently used, has left.
  await reads.load("s:1", fresh("v1 again"));
  expect(started).toBe(4);
  reads.forget("s");
  await reads.load("s:2", fresh("v2 again"));
  expect(started).toBe(5);
  expect(await reads.load("t:1", fresh("never"))).toBe("t1");
});
