import { useState } from "react";
import {
  Alert,
  Button,
  CircularProgress,
  IconButton,
  Tooltip,
} from "@mui/material";
import {
  CheckCircle2,
  Circle,
  ClipboardCheck,
  Pencil,
  Play,
  Trash2,
  XCircle,
} from "lucide-react";
import { errorMessage } from "../../../api/errors";
import type { TestCase } from "../../../types";
import { inputsText, valueText } from "../../../domain/testCases";
import type { SavedTests } from "./useSavedTests";
import type { TestResult } from "./savedTests";
import SaveTestDialog from "./SaveTestDialog";

/** A row's class: whether its last run passed, failed or there is none. */
function resultClass(result: TestResult | undefined): string {
  if (!result) return "";
  return result.passed ? "passed" : "failed";
}

/** What a saved test expects, as one line. */
function expectationText(test: TestCase): string {
  return test.expectedError !== null
    ? `Fails: “${test.expectedError}”`
    : `Returns ${valueText(test.expectedResult)}`;
}

function StatusIcon({
  result,
  running,
}: {
  result: TestResult | undefined;
  running: boolean;
}) {
  if (running) return <CircularProgress size={13} aria-label="Running" />;
  if (!result)
    return (
      <Circle size={14} className="saved-test-pending" aria-label="Not run" />
    );
  return result.passed ? (
    <CheckCircle2 size={15} className="saved-test-passed" aria-label="Passed" />
  ) : (
    <XCircle size={15} className="saved-test-failed" aria-label="Failed" />
  );
}

/**
 * The rule's saved tests in the Test panel: each with its inputs, what it
 * expects and, once run against the shown graph, whether it passed. A test
 * opens in Try inputs, takes a failing run's result as its new expectation,
 * or is edited or deleted.
 */
export default function SavedTestsView({
  tests,
  readOnly,
  onOpen,
}: {
  tests: SavedTests;
  /** A published version is shown: tests run, but expectations stay. */
  readOnly: boolean;
  /** Loads the test's inputs into Try inputs and runs them. */
  onOpen: (test: TestCase) => void;
}) {
  const [editing, setEditing] = useState<TestCase | null>(null);
  const [failure, setFailure] = useState("");
  const act = async (action: () => Promise<unknown>) => {
    setFailure("");
    try {
      await action();
    } catch (reason) {
      setFailure(errorMessage(reason));
    }
  };
  if (tests.status === "loading")
    return (
      <div className="saved-tests-state">
        <CircularProgress size={16} /> Loading saved tests…
      </div>
    );
  if (tests.status === "failed")
    return (
      <Alert
        severity="error"
        action={
          <Button color="inherit" size="small" onClick={tests.retry}>
            Retry
          </Button>
        }
      >
        Could not load saved tests: {tests.error}
      </Alert>
    );
  if (!tests.tests.length)
    return (
      <div className="test-empty">
        <span>
          <ClipboardCheck size={19} />
        </span>
        <strong>No saved tests yet</strong>
        <p className="saved-tests-hint">
          Run a test in Try inputs, then choose Save as test to keep its inputs
          and result. Saved tests run in one click and before you publish.
        </p>
      </div>
    );
  return (
    <div className="saved-tests">
      {failure && (
        <Alert severity="error" onClose={() => setFailure("")}>
          {failure}
        </Alert>
      )}
      <ul aria-label="Saved tests">
        {tests.tests.map((test) => {
          const result = tests.results[test.id];
          const running = tests.running.includes(test.id);
          const actual =
            result && !result.passed && "result" in result.run
              ? result.run.result
              : undefined;
          return (
            <li key={test.id} className={`saved-test ${resultClass(result)}`}>
              <StatusIcon result={result} running={running} />
              <div className="saved-test-main">
                <strong>{test.name}</strong>
                <code>{inputsText(test.inputs)}</code>
              </div>
              <div className="saved-test-expectation">
                <span>{expectationText(test)}</span>
                {result && (
                  <small>{result.passed ? "Passed" : result.reason}</small>
                )}
              </div>
              <div className="saved-test-actions">
                {actual !== undefined && !readOnly && (
                  <Tooltip
                    describeChild
                    title="The rule changed on purpose: expect this result from now on"
                  >
                    <Button
                      size="small"
                      onClick={() =>
                        void act(() =>
                          tests.update(test.id, {
                            name: test.name,
                            inputs: test.inputs,
                            expectedResult: actual,
                            expectedError: null,
                          }),
                        )
                      }
                    >
                      Expect this result
                    </Button>
                  </Tooltip>
                )}
                <Tooltip title="Open in Try inputs and run">
                  <IconButton
                    size="small"
                    aria-label={`Open ${test.name}`}
                    onClick={() => onOpen(test)}
                  >
                    <Play size={14} />
                  </IconButton>
                </Tooltip>
                {!readOnly && (
                  <>
                    <Tooltip title="Edit">
                      <IconButton
                        size="small"
                        aria-label={`Edit ${test.name}`}
                        onClick={() => setEditing(test)}
                      >
                        <Pencil size={14} />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Delete">
                      <IconButton
                        size="small"
                        aria-label={`Delete ${test.name}`}
                        onClick={() => {
                          if (window.confirm(`Delete the test “${test.name}”?`))
                            void act(() => tests.remove(test.id));
                        }}
                      >
                        <Trash2 size={14} />
                      </IconButton>
                    </Tooltip>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {editing && (
        <SaveTestDialog
          title="Edit test"
          initial={editing}
          editInputs
          onSave={(write) => tests.update(editing.id, write)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
