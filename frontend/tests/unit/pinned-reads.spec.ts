import { expect, test } from "@playwright/test";
import { PinnedReads } from "../../src/app/pinnedReads";

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

test("a read the last subscriber abandoned is not joined again: the next load starts afresh", async () => {
  // Re-picking a version joined the read the card had just aborted and showed "This operation was aborted".
  const reads = new PinnedReads<string>();
  let started = 0;
  const first = deferred<string>();
  const second = deferred<string>();
  const read = (signal: AbortSignal) => {
    started += 1;
    const own = started === 1 ? first : second;
    signal.addEventListener("abort", () =>
      own.reject(new DOMException("aborted by the transport", "AbortError")),
    );
    return own.promise;
  };
  const controller = new AbortController();
  const abandoned = reads.load("s:1", read, controller.signal);
  controller.abort();
  await expect(abandoned).rejects.toThrow();
  const fresh = reads.load("s:1", read);
  expect(started).toBe(2);
  second.resolve("v1");
  expect(await fresh).toBe("v1");
});

test("forget lets live subscribers finish their read and only stops remembering it", async () => {
  // Closing the source manager aborted a sibling card's read, which then showed a permanent error.
  const reads = new PinnedReads<string>();
  let started = 0;
  const pending = deferred<string>();
  let readSignal: AbortSignal | null = null;
  const read = (signal: AbortSignal) => {
    started += 1;
    readSignal = signal;
    return started === 1 ? pending.promise : Promise.resolve("v1 again");
  };
  const sibling = reads.load("s:1", read);
  reads.forget("s");
  expect(readSignal!.aborted).toBe(false);
  pending.resolve("v1");
  expect(await sibling).toBe("v1");
  // Not cached: the next load reads again, and its result is kept.
  expect(await reads.load("s:1", read)).toBe("v1 again");
  expect(started).toBe(2);
  expect(await reads.load("s:1", read)).toBe("v1 again");
  expect(started).toBe(2);
});

test("a read that settles after forget does not remove the fresh read under its key", async () => {
  const reads = new PinnedReads<string>();
  let started = 0;
  const old = deferred<string>();
  const read = () => {
    started += 1;
    return started === 1 ? old.promise : Promise.resolve("new");
  };
  const stale = reads.load("s:1", read);
  reads.forget("s");
  const fresh = reads.load("s:1", read);
  const joined = reads.load("s:1", read);
  expect(started).toBe(2);
  old.resolve("old");
  expect(await stale).toBe("old");
  // The stale read settled without deleting the fresh entry: a third load still joins it.
  expect(await fresh).toBe("new");
  expect(await joined).toBe("new");
  expect(started).toBe(2);
});

test("a load with an already-aborted signal starts no read", async () => {
  const reads = new PinnedReads<string>();
  let started = 0;
  const controller = new AbortController();
  controller.abort();
  await expect(
    reads.load(
      "s:1",
      async () => {
        started += 1;
        return "v1";
      },
      controller.signal,
    ),
  ).rejects.toThrow();
  expect(started).toBe(0);
});
