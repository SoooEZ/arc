import { expect, test } from "@playwright/test";
import { renderHook } from "../helpers/hookHost";
import { useExecutionRequest } from "../../src/features/execution/useExecutionRequest";
import { useLibraryInsertion } from "../../src/features/studio/useLibraryInsertion";
import type { Execution } from "../../src/types";

/**
 * The pending-command hooks each hand-write their abort controller, because
 * their completion policies differ (a keyed request replaces and clears, a
 * library insertion replaces and reports once). These tests pin the policies
 * each copy promises: a newer request or key aborts the previous one, a late
 * answer is dropped, a failure reports unless its request was aborted, and
 * unmounting aborts.
 */

/** A read the test settles, which records the signal it was given. */
function controlledRead<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  let signal: AbortSignal | null = null;
  return {
    read: (given: AbortSignal) => {
      signal = given;
      return promise;
    },
    resolve,
    reject,
    get aborted() {
      return signal?.aborted ?? false;
    },
  };
}

/** Lets the settled read's continuation run inside the host's act scope. */
const settled = () => new Promise((next) => setTimeout(next, 0));

const execution = (result: number): Execution =>
  ({ result }) as unknown as Execution;

test("an execution request belongs to its key: a key change aborts it and drops its late answer", async () => {
  const host = await renderHook(
    ({ key }: { key: string }) => useExecutionRequest(key),
    { key: "graph-1" },
  );
  const first = controlledRead<Execution>();
  await host.run(async () => void host.current.run(first.read));
  expect(host.current.running).toBe(true);
  await host.rerender({ key: "graph-2" });
  expect(first.aborted).toBe(true);
  expect(host.current.running).toBe(false);
  await host.run(async () => {
    first.resolve(execution(1));
    await settled();
  });
  expect(host.current.result).toBeNull();
  expect(host.current.error).toBe("");
  await host.unmount();
});

test("a new run replaces the pending one, and only the latest answer shows", async () => {
  const host = await renderHook(
    ({ key }: { key: string }) => useExecutionRequest(key),
    { key: "graph-1" },
  );
  const first = controlledRead<Execution>();
  const second = controlledRead<Execution>();
  await host.run(async () => void host.current.run(first.read));
  await host.run(async () => void host.current.run(second.read));
  expect(first.aborted).toBe(true);
  expect(second.aborted).toBe(false);
  await host.run(async () => {
    first.resolve(execution(1));
    await settled();
  });
  expect(host.current.running).toBe(true);
  expect(host.current.result).toBeNull();
  await host.run(async () => {
    second.resolve(execution(2));
    await settled();
  });
  expect(host.current.running).toBe(false);
  expect(host.current.result).toEqual(execution(2));
  await host.unmount();
});

test("a failed execution reports its message unless its request was cleared or unmounted", async () => {
  const host = await renderHook(
    ({ key }: { key: string }) => useExecutionRequest(key),
    { key: "graph-1" },
  );
  const failing = controlledRead<Execution>();
  await host.run(async () => void host.current.run(failing.read));
  await host.run(async () => {
    failing.reject(new Error("Engine exploded"));
    await settled();
  });
  expect(host.current.error).toBe("Engine exploded");
  expect(host.current.running).toBe(false);
  const cleared = controlledRead<Execution>();
  await host.run(async () => void host.current.run(cleared.read));
  await host.run(async () => host.current.clear());
  expect(cleared.aborted).toBe(true);
  await host.run(async () => {
    cleared.reject(new Error("The read was aborted"));
    await settled();
  });
  expect(host.current.error).toBe("");
  const unmounted = controlledRead<Execution>();
  await host.run(async () => void host.current.run(unmounted.read));
  await host.unmount();
  expect(unmounted.aborted).toBe(true);
});

test("a library insertion aborts the previous choice, which then reports nothing", async () => {
  const host = await renderHook(() => useLibraryInsertion(), {});
  const first = controlledRead<void>();
  const second = controlledRead<void>();
  await host.run(async () =>
    host.current.onCardClick({ detail: 1 }, "rule-a", first.read),
  );
  expect(host.current.busy).toBe("rule-a");
  await host.run(async () =>
    host.current.onCardClick({ detail: 1 }, "rule-b", second.read),
  );
  expect(first.aborted).toBe(true);
  expect(host.current.busy).toBe("rule-b");
  await host.run(async () => {
    first.reject(new Error("The read was aborted"));
    await settled();
  });
  expect(host.current.busy).toBe("rule-b");
  expect(host.current.error).toBe("");
  await host.run(async () => {
    second.resolve();
    await settled();
  });
  expect(host.current.busy).toBe("");
  expect(host.current.error).toBe("");
  await host.unmount();
});

test("a library insertion reports a failure of the current choice, ignores repeated clicks and aborts on unmount", async () => {
  const host = await renderHook(() => useLibraryInsertion(), {});
  const failing = controlledRead<void>();
  await host.run(async () =>
    host.current.onCardClick({ detail: 1 }, "rule-a", failing.read),
  );
  await host.run(async () => {
    failing.reject(new Error("Version not found"));
    await settled();
  });
  expect(host.current.busy).toBe("");
  expect(host.current.error).toBe("Version not found");
  // The second click of a double click starts nothing (lesson F30).
  let started = 0;
  await host.run(async () =>
    host.current.onCardClick({ detail: 2 }, "rule-a", async () => {
      started += 1;
    }),
  );
  expect(started).toBe(0);
  const pending = controlledRead<void>();
  await host.run(async () =>
    host.current.onCardClick({ detail: 1 }, "rule-b", pending.read),
  );
  expect(host.current.error).toBe("");
  await host.unmount();
  expect(pending.aborted).toBe(true);
});
