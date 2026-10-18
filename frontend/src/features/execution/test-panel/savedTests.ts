import { studioApi } from "../../../api/studio";
import { errorMessage } from "../../../api/errors";
import type { Definition, TestCase } from "../../../types";
import {
  testOutcome,
  type TestOutcome,
  type TestRun,
} from "../../../domain/testCases";

/** A saved test's run against one graph and whether it met the test. */
export interface TestResult extends TestOutcome {
  run: TestRun;
}

/** Runs that share the server at once; each is its own preview request. */
const concurrentRuns = 3;

/**
 * Runs each saved test against `definition` as the Test panel previews a
 * graph, without a trace, a few at a time, and reports each result as it
 * arrives. A failed request is the test's run failing with that message.
 * Nothing new starts once `signal` aborts, and an aborted run reports nothing.
 */
export async function runSavedTests(
  definition: Definition,
  tests: readonly TestCase[],
  signal: AbortSignal,
  onResult: (id: number, result: TestResult) => void,
): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < tests.length && !signal.aborted) {
      const test = tests[next++];
      let run: TestRun;
      try {
        const execution = await studioApi.preview(
          definition,
          test.inputs,
          { trace: false },
          { signal },
        );
        run = { result: execution.result };
      } catch (failure) {
        if (signal.aborted) return;
        run = { error: errorMessage(failure) };
      }
      onResult(test.id, { ...testOutcome(test, run), run });
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrentRuns, tests.length) }, worker),
  );
}

/** How many results passed and failed, and how many tests have none yet. */
export function resultCounts(
  tests: readonly TestCase[],
  results: Readonly<Record<number, TestResult | undefined>>,
) {
  let passed = 0;
  let failed = 0;
  for (const test of tests) {
    const result = results[test.id];
    if (result?.passed) passed++;
    else if (result) failed++;
  }
  return { passed, failed, pending: tests.length - passed - failed };
}
