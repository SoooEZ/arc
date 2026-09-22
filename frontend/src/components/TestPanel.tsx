import { useEffect, useState } from "react";
import { Alert, Button, IconButton, Tab, Tabs, TextField } from "@mui/material";
import {
  CheckCircle2,
  ChevronRight,
  Clock3,
  Play,
  Terminal,
  X,
} from "lucide-react";
import { studioApi } from "../api/studio";
import type { GraphProblem } from "../api/errors";
import {
  curlExample,
  parseExecutionInputs,
  sampleInputs,
} from "../domain/executionInputs";
import { useExecutionRequest } from "../features/execution/useExecutionRequest";
import type { ReferenceTarget } from "./ReferenceDialog";
import type { Definition, Execution } from "../types";
import { NodeIcon } from "./Icons";

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
  const inputSchema = JSON.stringify(definition.inputs);
  const execution = useExecutionRequest(JSON.stringify([definition, input]));
  const { result, error, running, problem } = execution;
  const locations = problem?.locations ?? [];
  useEffect(() => {
    setInput(JSON.stringify(sampleInputs(definition), null, 2));
  }, [inputSchema]); // Reset example values when the input contract changes.
  useEffect(() => {
    onResult(result);
    onError(problem);
  }, [result, problem, onResult, onError]);
  const run = () =>
    execution.run((signal) =>
      studioApi.preview(definition, parseExecutionInputs(input), { signal }),
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
          <Tabs value={tab} onChange={(_, value) => setTab(value)}>
            <Tab label="Input JSON" />
            <Tab label="cURL" />
          </Tabs>
          {tab === 0 ? (
            <TextField
              slotProps={{ htmlInput: { "aria-label": "Test input JSON" } }}
              multiline
              rows={6}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              className="json-input"
              spellCheck={false}
            />
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
            <Alert severity="error">
              {error}
              <div className="error-actions">
                {locations
                  .filter(
                    (l) =>
                      !l.ruleId ||
                      l.ruleId === "preview" ||
                      (l.ruleId === ruleId && l.version === publishedVersion),
                  )
                  .slice(-1)
                  .map((l) => (
                    <Button
                      key={l.nodeId}
                      size="small"
                      color="inherit"
                      onClick={() => onNode(l.nodeId)}
                    >
                      Show problem · {l.label}
                    </Button>
                  ))}
                {locations
                  .filter(
                    (l) =>
                      l.ruleId &&
                      l.ruleId !== "preview" &&
                      !(l.ruleId === ruleId && l.version === publishedVersion),
                  )
                  .map((l, i) => (
                    <Button
                      key={i}
                      size="small"
                      color="inherit"
                      onClick={() =>
                        onOpenReference({
                          ruleId: l.ruleId!,
                          version: l.version!,
                          nodeId: l.nodeId,
                        })
                      }
                    >
                      Open problem · {l.label}
                    </Button>
                  ))}
                {!locations.length && (
                  <Button
                    size="small"
                    color="inherit"
                    onClick={() => {
                      setTab(0);
                      requestAnimationFrame(() =>
                        document
                          .querySelector<HTMLTextAreaElement>(
                            '[aria-label="Test input JSON"]',
                          )
                          ?.focus(),
                      );
                    }}
                  >
                    Edit test inputs
                  </Button>
                )}
              </div>
            </Alert>
          ) : result ? (
            <>
              <div className="test-result">
                <span>
                  <CheckCircle2 size={15} />
                  Result
                </span>
                <strong data-testid="test-result">
                  {JSON.stringify(result.result)}
                </strong>
                <small>
                  <Clock3 size={12} />
                  {(result.durationMicros / 1000).toFixed(2)} ms
                </small>
              </div>
              {!!result.sources?.length && (
                <div className="source-reads">
                  {result.sources.map((s, i) => (
                    <div key={i}>
                      <span>
                        {s.input} ← {s.sourceId} v{s.version}
                      </span>
                      <strong>
                        {s.status === "DEFAULT" ? "Default used" : "Fetched"}
                      </strong>
                      <small>{(s.durationMicros / 1000).toFixed(1)} ms</small>
                    </div>
                  ))}
                </div>
              )}
              <div className="trace-label">
                EXECUTION TRACE <span>{result.trace.length} steps</span>
              </div>
              <div className="trace-list">
                {result.trace.map((step, i) => (
                  <button
                    key={i}
                    onClick={() => step.depth === 0 && onNode(step.nodeId)}
                    disabled={step.depth > 0}
                    style={{ paddingLeft: 6 + step.depth * 12 }}
                  >
                    <span className="trace-number">{i + 1}</span>
                    <NodeIcon type={step.type} size={13} />
                    <span>
                      {step.label}
                      {step.depth > 0 && (
                        <small>
                          {" "}
                          · {step.ruleId} v{step.version}
                        </small>
                      )}
                    </span>
                    <code>
                      {step.type === "INPUT"
                        ? "received"
                        : JSON.stringify(step.value)}
                    </code>
                    {step.branch === "true" || step.branch === "false" ? (
                      <span className={`trace-branch ${step.branch}`}>
                        {step.branch}
                      </span>
                    ) : (
                      <ChevronRight size={12} />
                    )}
                  </button>
                ))}
              </div>
            </>
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
