import { useCallback, useEffect, useRef, useState } from "react";
import { testCaseApi } from "../../../api/testCases";
import { errorMessage } from "../../../api/errors";
import type { Definition, TestCase, TestCaseWrite } from "../../../types";
import { testOutcome, type TestRun } from "../../../domain/testCases";
import { runSavedTests, type TestResult } from "./savedTests";

type TestList =
  | { status: "loading" }
  | { status: "failed"; error: string }
  | { status: "ready"; tests: TestCase[] };

/** Results belong to the graph they ran against; another graph shows none. */
interface Results {
  graphKey: string;
  results: Record<number, TestResult | undefined>;
  running: number[];
}

const noTests: TestCase[] = [];

/**
 * A rule's saved tests in the editor: read when first needed (`enabled`),
 * changed through the API, and run against the shown graph. A graph edit
 * stops a run and hides its results, which describe the earlier graph.
 */
export function useSavedTests(
  ruleId: string,
  definition: Definition,
  graphKey: string,
  enabled: boolean,
) {
  const [list, setList] = useState<TestList>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [needed, setNeeded] = useState(enabled);
  if (enabled && !needed) setNeeded(true);
  useEffect(() => {
    if (!needed) return;
    const controller = new AbortController();
    testCaseApi.list(ruleId, { signal: controller.signal }).then(
      (tests) => setList({ status: "ready", tests }),
      (failure) => {
        if (!controller.signal.aborted)
          setList({ status: "failed", error: errorMessage(failure) });
      },
    );
    return () => controller.abort();
  }, [needed, ruleId, attempt]);
  const retry = () => {
    setList({ status: "loading" });
    setAttempt((current) => current + 1);
  };

  const [runs, setRuns] = useState<Results>({
    graphKey,
    results: {},
    running: [],
  });
  const active = useRef<AbortController | null>(null);
  useEffect(() => {
    active.current?.abort();
  }, [graphKey]);
  useEffect(() => () => active.current?.abort(), []);
  const tests = list.status === "ready" ? list.tests : noTests;
  const current = runs.graphKey === graphKey ? runs : null;

  /** Runs every saved test against the shown graph, replacing earlier results. */
  const run = useCallback(() => {
    if (!tests.length) return;
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setRuns({
      graphKey,
      results: {},
      running: tests.map((test) => test.id),
    });
    void runSavedTests(definition, tests, controller.signal, (id, result) =>
      setRuns((previous) =>
        previous.graphKey === graphKey
          ? {
              ...previous,
              results: { ...previous.results, [id]: result },
              running: previous.running.filter((other) => other !== id),
            }
          : previous,
      ),
    ).finally(() => {
      if (active.current === controller) active.current = null;
    });
  }, [tests, definition, graphKey]);

  /**
   * Saves a new test; resolves with it, or rejects with the server's reason.
   * `run` is the shown graph's run it was saved from, which is its result on
   * this graph, so the list need not run it again.
   */
  const create = async (write: TestCaseWrite, run?: TestRun) => {
    const created = await testCaseApi.create(ruleId, write);
    setList((previous) =>
      previous.status === "ready"
        ? { ...previous, tests: [...previous.tests, created] }
        : previous,
    );
    if (run) {
      const result: TestResult = { ...testOutcome(created, run), run };
      setRuns((previous) =>
        previous.graphKey === graphKey
          ? {
              ...previous,
              results: { ...previous.results, [created.id]: result },
            }
          : { graphKey, results: { [created.id]: result }, running: [] },
      );
    }
    return created;
  };
  const update = async (id: number, write: TestCaseWrite) => {
    const saved = await testCaseApi.update(ruleId, id, write);
    setList((previous) =>
      previous.status === "ready"
        ? {
            ...previous,
            tests: previous.tests.map((test) =>
              test.id === id ? saved : test,
            ),
          }
        : previous,
    );
    // Its result described the test before this change.
    setRuns((previous) => ({
      ...previous,
      results: { ...previous.results, [id]: undefined },
    }));
    return saved;
  };
  const remove = async (id: number) => {
    await testCaseApi.delete(ruleId, id);
    setList((previous) =>
      previous.status === "ready"
        ? {
            ...previous,
            tests: previous.tests.filter((test) => test.id !== id),
          }
        : previous,
    );
  };

  return {
    status: list.status,
    error: list.status === "failed" ? list.error : "",
    tests,
    results: current?.results ?? {},
    running: current?.running ?? [],
    retry,
    run,
    create,
    update,
    remove,
  };
}

export type SavedTests = ReturnType<typeof useSavedTests>;
