import { useState, type ReactNode } from "react";
import {
  Alert,
  Button,
  IconButton,
  Tab,
  Tabs,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
} from "@mui/material";
import { Hammer, Maximize2, Minimize2, Play, Terminal, X } from "lucide-react";
import type { Definition } from "../../../types";
import type { GraphProblem } from "../../../api/errors";
import type {
  PreviewExecution,
  PreviewInputView,
  TestPanelView,
} from "./usePreviewExecution";
import type { ReferenceLocation } from "../types";
import { stringifyJson } from "../../../domain/json";
import ExecutionError from "../ExecutionError";
import ExecutionResult from "../ExecutionResult";
import ExecutionOptionsFields from "../ExecutionOptionsFields";
import LazyInputJsonEditor from "../LazyInputJsonEditor";
import InputForm from "../../../components/InputForm";
import { useSaveRunAsTest } from "./useSaveRunAsTest";
import SavedTestsView from "./SavedTestsView";
import type { SavedTests } from "./useSavedTests";
import { resultCounts } from "./savedTests";
import { publishedCurl } from "../publishedCurl";

interface Props {
  preview: PreviewExecution;
  /** The rule's saved tests, run against the shown graph. */
  tests: SavedTests;
  ruleId: string;
  /** The shown graph, whose exits caption the trace's branches. */
  definition: Definition;
  /** The version shown in the editor; null for the draft. */
  version: number | null;
  /** The version the published endpoint runs, for the cURL example. */
  publishedVersion: number | null;
  /** Code has edits that are not built into the graph that preview runs. */
  buildPending: boolean;
  /** The shown graph's Input node, where caller-input failures surface. */
  inputNodeId: string | null;
  /** Every static problem of the shown graph; a refused run names only the first. */
  graphProblems: GraphProblem[];
  onOpenReference: (target: ReferenceLocation) => void;
  onNode: (id: string) => void;
}

/** "Saved tests · 3", with how many failed once they ran. */
function savedTestsLabel(tests: SavedTests): string {
  if (tests.status !== "ready") return "Saved tests";
  const { failed } = resultCounts(tests.tests, tests.results);
  const count = `Saved tests · ${tests.tests.length}`;
  return failed ? `${count} · ${failed} failed` : count;
}

/** Presents the editor's preview session; the session state lives in usePreviewExecution. */
export default function TestPanel({
  preview,
  tests,
  ruleId,
  definition,
  version,
  publishedVersion,
  buildPending,
  inputNodeId,
  graphProblems,
  onOpenReference,
  onNode,
}: Props) {
  const [inputFocusRequest, setInputFocusRequest] = useState(0);
  const [blocked, setBlocked] = useState<string[]>([]);
  const saveRun = useSaveRunAsTest(preview, tests);
  const saved = preview.panelView === "saved";
  const counts = resultCounts(tests.tests, tests.results);
  /** A field that shows text its type cannot take holds the run and gets the focus. */
  const runTest = () => {
    if (preview.inputView === "form" && preview.invalidInputs.length) {
      setBlocked(preview.invalidInputs);
      document
        .querySelector<HTMLInputElement>(
          `.test-panel input[aria-label="${CSS.escape(preview.invalidInputs[0])}"]`,
        )
        ?.focus();
      return;
    }
    setBlocked([]);
    preview.run();
  };
  return (
    <div className={`test-panel ${preview.expanded ? "expanded" : ""}`}>
      <div className="test-panel-heading">
        <div>
          <Terminal size={16} />
          <strong>Test this graph</strong>
          <span className="test-badge">Preview</span>
          <ToggleButtonGroup
            exclusive
            size="small"
            className="test-panel-views"
            aria-label="Test panel view"
            value={preview.panelView}
            onChange={(_, view: TestPanelView | null) => {
              if (view) preview.setPanelView(view);
            }}
          >
            <ToggleButton value="try">Try inputs</ToggleButton>
            <ToggleButton value="saved">{savedTestsLabel(tests)}</ToggleButton>
          </ToggleButtonGroup>
        </div>
        <div>
          {saved ? (
            <>
              {tests.status === "ready" && tests.tests.length > 0 && (
                <span className="saved-tests-summary">
                  {counts.passed + counts.failed
                    ? `${counts.passed} passed · ${counts.failed} failed`
                    : "Not run on this graph yet"}
                </span>
              )}
              <Button
                size="small"
                variant="contained"
                startIcon={<Play size={13} />}
                onClick={() => tests.run()}
                disabled={
                  !tests.tests.length ||
                  buildPending ||
                  tests.running.length > 0
                }
              >
                {tests.running.length ? "Running…" : "Run all"}
              </Button>
            </>
          ) : (
            <Button
              size="small"
              variant="contained"
              startIcon={<Play size={13} />}
              onClick={runTest}
              disabled={preview.running || buildPending}
            >
              {preview.running ? "Running…" : "Run test"}
            </Button>
          )}
          <Tooltip title={preview.expanded ? "Shrink panel" : "Expand panel"}>
            <IconButton
              aria-label={
                preview.expanded ? "Shrink test panel" : "Expand test panel"
              }
              size="small"
              onClick={preview.toggleExpanded}
            >
              {preview.expanded ? (
                <Minimize2 size={15} />
              ) : (
                <Maximize2 size={15} />
              )}
            </IconButton>
          </Tooltip>
          <IconButton
            aria-label="Close test panel"
            size="small"
            onClick={preview.close}
          >
            <X size={16} />
          </IconButton>
        </div>
      </div>
      {saved ? (
        <div className="test-panel-saved">
          {buildPending ? (
            <BuildFirst />
          ) : (
            <SavedTestsView
              tests={tests}
              readOnly={version !== null}
              onOpen={(test) =>
                preview.tryInputs(stringifyJson(test.inputs, 2))
              }
            />
          )}
        </div>
      ) : (
        <div className="test-panel-content">
          <div className="test-input">
            <Tabs
              value={preview.inputView}
              onChange={(_, view: PreviewInputView) =>
                preview.setInputView(view)
              }
            >
              <Tab value="form" label="Form" />
              <Tab value="json" label="Input JSON" />
              <Tab value="curl" label="cURL" />
            </Tabs>
            {preview.inputView === "form" && (
              <InputForm
                inputs={definition.inputs}
                text={preview.input}
                onChange={preview.changeInput}
                onValidity={preview.reportValidity}
              />
            )}
            {preview.inputView === "json" && (
              <LazyInputJsonEditor
                label="Test input JSON"
                value={preview.input}
                onChange={preview.changeInput}
                focusRequest={inputFocusRequest}
              />
            )}
            {preview.inputView === "curl" && (
              <div className="curl-preview">
                {!publishedVersion && (
                  <span>Publish this rule to enable its endpoint.</span>
                )}
                <pre>
                  {publishedCurl(
                    ruleId,
                    preview.input,
                    publishedVersion,
                    preview.options,
                  )}
                </pre>
                <small>
                  cURL executes the published version. Preview uses the graph
                  above.
                </small>
              </div>
            )}
            <details
              className="run-options"
              open={preview.optionsOpen}
              onToggle={(event) =>
                preview.setOptionsOpen(event.currentTarget.open)
              }
            >
              <summary>
                Run options ·{" "}
                {preview.options.trace ? "with trace" : "no trace"} ·{" "}
                {preview.options.timeoutMs / 1000} s limit
              </summary>
              <ExecutionOptionsFields
                value={preview.options}
                onChange={preview.changeOptions}
              />
            </details>
          </div>
          <div className="test-output">
            {blocked.length > 0 &&
            preview.invalidInputs.some((name) => blocked.includes(name)) ? (
              <Alert severity="warning">
                {preview.invalidInputs.length === 1
                  ? `Fix the marked input before running: ${preview.invalidInputs[0]}.`
                  : `Fix the marked inputs before running: ${preview.invalidInputs.join(", ")}.`}
              </Alert>
            ) : (
              <PreviewOutput
                preview={preview}
                definition={definition}
                shown={{ ruleId, version }}
                inputNodeId={inputNodeId}
                graphProblems={graphProblems}
                buildPending={buildPending}
                saveAction={version === null ? saveRun.action : null}
                onNode={onNode}
                onOpenReference={onOpenReference}
                onEditInputs={() => {
                  preview.setInputView("json");
                  setInputFocusRequest((request) => request + 1);
                }}
              />
            )}
          </div>
        </div>
      )}
      {saveRun.dialog}
    </div>
  );
}

function BuildFirst() {
  return (
    <div className="test-empty">
      <span>
        <Hammer size={19} />
      </span>
      <strong>Build to test these changes</strong>
      <p>
        Preview runs the built graph. Build the code
        <br />
        to test your latest edits.
      </p>
    </div>
  );
}

function PreviewOutput({
  preview,
  definition,
  shown,
  inputNodeId,
  graphProblems,
  buildPending,
  saveAction,
  onNode,
  onOpenReference,
  onEditInputs,
}: {
  preview: PreviewExecution;
  definition: Definition;
  shown: { ruleId: string; version: number | null };
  inputNodeId: string | null;
  graphProblems: GraphProblem[];
  buildPending: boolean;
  /** Saves this run as a test; none while a published version is shown. */
  saveAction: ReactNode;
  onNode: (id: string) => void;
  onOpenReference: (target: ReferenceLocation) => void;
  onEditInputs: () => void;
}) {
  if (buildPending) return <BuildFirst />;
  if (preview.error)
    return (
      <ExecutionError
        error={preview.error}
        problem={preview.problem}
        others={graphProblems.filter(
          (problem) => problem.message !== preview.error,
        )}
        shown={shown}
        inputNodeId={inputNodeId}
        action={saveAction}
        onNode={onNode}
        onOpenReference={onOpenReference}
        onEditInputs={onEditInputs}
      />
    );
  if (preview.result)
    return (
      <ExecutionResult
        result={preview.result}
        definition={definition}
        action={saveAction}
        compactTiming
        onNode={onNode}
        requestDurationMs={preview.requestDurationMs}
      />
    );
  return (
    <div className="test-empty">
      <span>
        <Play size={19} />
      </span>
      <strong>Follow the logic</strong>
      <p>
        Send a set of inputs to see the result
        <br />
        and every decision along the way.
      </p>
    </div>
  );
}
