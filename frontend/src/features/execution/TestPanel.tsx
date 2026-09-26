import { lazy, Suspense, useEffect, useState } from "react";
import { Button, IconButton, Tab, Tabs } from "@mui/material";
import { Play, Terminal, X } from "lucide-react";
import { studioApi } from "../../api/studio";
import type { GraphProblem } from "../../api/errors";
import {
  curlExample,
  parseExecutionInputs,
  sampleInputs,
} from "../../domain/executionInputs";
import { useExecutionRequest } from "./useExecutionRequest";
import type { ReferenceTarget } from "../editor/types";
import type { Definition, Execution } from "../../types";
import ExecutionError from "./ExecutionError";
import ExecutionResult from "./ExecutionResult";
import ExecutionOptionsFields from "./ExecutionOptionsFields";

const InputJsonEditor = lazy(() => import("./InputJsonEditor"));

export default function TestPanel({
  definition,
  ruleId,
  publishedVersion,
  onResult,
  onError,
  onOpenReference,
  onNode,
  onClose,
}: {
  definition: Definition;
  ruleId: string;
  publishedVersion: number | null;
  onResult: (r: Execution | null) => void;
  onError: (problem: GraphProblem | null) => void;
  onOpenReference: (target: ReferenceTarget) => void;
  onNode: (id: string) => void;
  onClose: () => void;
}) {
  const [input, setInput] = useState(() =>
    JSON.stringify(sampleInputs(definition), null, 2),
  );
  const [tab, setTab] = useState(0);
  const [trace, setTrace] = useState(true);
  const [timeoutMs, setTimeoutMs] = useState(30000);
  const [inputFocusRequest, setInputFocusRequest] = useState(0);
  const inputSchema = JSON.stringify(definition.inputs);
  const execution = useExecutionRequest(
    JSON.stringify([definition, input, trace, timeoutMs]),
  );
  const { result, error, running, problem } = execution;
  useEffect(() => {
    setInput(JSON.stringify(sampleInputs(definition), null, 2));
  }, [inputSchema]); // Reset example values when the input contract changes.
  useEffect(() => {
    onResult(result);
    onError(problem);
  }, [result, problem, onResult, onError]);
  const run = () =>
    execution.run((signal) =>
      studioApi.preview(definition, parseExecutionInputs(input), {
        signal,
        trace,
        timeoutMs,
      }),
    );
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(input);
  } catch {
    /* Keep the JSON editor editable while invalid. */
  }
  return (
    <div className="test-panel">
      <div className="test-panel-heading">
        <div>
          <Terminal size={16} />
          <strong>Test this graph</strong>
          <span className="test-badge">Preview</span>
        </div>
        <div>
          <Button
            size="small"
            variant="contained"
            startIcon={<Play size={13} />}
            onClick={run}
            disabled={running}
          >
            {running ? "Running…" : "Run test"}
          </Button>
          <IconButton
            aria-label="Close test panel"
            size="small"
            onClick={onClose}
          >
            <X size={16} />
          </IconButton>
        </div>
      </div>
      <div className="test-panel-content">
        <div className="test-input">
          <ExecutionOptionsFields
            trace={trace}
            timeoutMs={timeoutMs}
            onTrace={setTrace}
            onTimeout={setTimeoutMs}
          />
          <Tabs value={tab} onChange={(_, value) => setTab(value)}>
            <Tab label="Input JSON" />
            <Tab label="cURL" />
          </Tabs>
          {tab === 0 ? (
            <Suspense
              fallback={
                <div className="execution-json-editor" role="status">
                  Loading JSON editor…
                </div>
              }
            >
              <InputJsonEditor
                label="Test input JSON"
                value={input}
                onChange={setInput}
                focusRequest={inputFocusRequest}
              />
            </Suspense>
          ) : (
            <div className="curl-preview">
              {!publishedVersion && (
                <span>Publish this rule to enable its endpoint.</span>
              )}
              <pre>
                {curlExample(
                  window.location.origin,
                  ruleId,
                  parsed,
                  publishedVersion,
                  { trace, timeoutMs },
                )}
              </pre>
              <small>
                cURL executes the published version. Preview uses the graph
                above.
              </small>
            </div>
          )}
        </div>
        <div className="test-output">
          {error ? (
            <ExecutionError
              error={error}
              problem={problem}
              ruleId={ruleId}
              publishedVersion={publishedVersion}
              onNode={onNode}
              onOpenReference={onOpenReference}
              onEditInputs={() => {
                setTab(0);
                setInputFocusRequest((request) => request + 1);
              }}
            />
          ) : result ? (
            <ExecutionResult
              result={result}
              onNode={onNode}
              requestDurationMs={execution.requestDurationMs}
            />
          ) : (
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
          )}
        </div>
      </div>
    </div>
  );
}
