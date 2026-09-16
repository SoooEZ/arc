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
import { api, errorMessage } from "../api";
import type { Definition, Execution } from "../types";
import { NodeIcon } from "./Icons";

export function sampleInputs(definition: Definition): Record<string, unknown> {
  return Object.fromEntries(
    definition.inputs
      .filter((p) => p.required || p.defaultValue != null)
      .map((p) => [
        p.name,
        p.defaultValue ??
          (p.type === "NUMBER"
            ? p.name === "rate"
              ? 0.1
              : 150
            : p.type === "BOOLEAN"
              ? true
              : p.name === "customerTier"
                ? "premium"
                : "example"),
      ]),
  );
}
export function curlExample(
  id: string,
  inputs: Record<string, unknown>,
  version?: number | null,
) {
  const body = JSON.stringify(
    { inputs, ...(version ? { version } : {}) },
    null,
    2,
  );
  return `curl -X POST '${window.location.origin}/api/rules/${id}/execute' \\\n  -H 'Content-Type: application/json' \\\n  -d '${body.replace(/'/g, "'\\''")}'`;
}
export default function TestPanel({
  definition,
  ruleId,
  publishedVersion,
  onResult,
  onNode,
  onClose,
}: {
  definition: Definition;
  ruleId: string;
  publishedVersion: number | null;
  onResult: (r: Execution | null) => void;
  onNode: (id: string) => void;
  onClose: () => void;
}) {
  const [input, setInput] = useState(() =>
    JSON.stringify(sampleInputs(definition), null, 2),
  );
  const [result, setResult] = useState<Execution | null>(null);
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const [tab, setTab] = useState(0);
  const inputSchema = JSON.stringify(definition.inputs);
  const graph = JSON.stringify(definition);
  useEffect(() => {
    setInput(JSON.stringify(sampleInputs(definition), null, 2));
  }, [inputSchema]); // Reset example values when the input contract changes.
  useEffect(() => {
    setResult(null);
    setError("");
    onResult(null);
  }, [graph, onResult]);
  const run = async () => {
    setRunning(true);
    setError("");
    setResult(null);
    onResult(null);
    try {
      const values: unknown = JSON.parse(input);
      if (values == null || typeof values !== "object" || Array.isArray(values))
        throw new Error("Inputs must be a JSON object.");
      const execution = await api.preview(
        definition,
        values as Record<string, unknown>,
      );
      setResult(execution);
      onResult(execution);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setRunning(false);
    }
  };
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
              onChange={(e) => {
                setInput(e.target.value);
                setResult(null);
                onResult(null);
                setError("");
              }}
              className="json-input"
              spellCheck={false}
            />
          ) : (
            <div className="curl-preview">
              {!publishedVersion && (
                <span>Publish this rule to enable its endpoint.</span>
              )}
              <pre>{curlExample(ruleId, parsed, publishedVersion)}</pre>
              <small>
                cURL executes the published version. Preview uses the graph
                above.
              </small>
            </div>
          )}
        </div>
        <div className="test-output">
          {error ? (
            <Alert severity="error">{error}</Alert>
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
