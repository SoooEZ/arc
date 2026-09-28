import { useState } from "react";
import { Button, IconButton, Tab, Tabs } from "@mui/material";
import { Hammer, Play, Terminal, X } from "lucide-react";
import type { Definition } from "../../types";
import type {
  PreviewExecution,
  PreviewInputView,
} from "../editor/usePreviewExecution";
import type { ReferenceTarget } from "../editor/types";
import ExecutionError from "./ExecutionError";
import ExecutionResult from "./ExecutionResult";
import ExecutionOptionsFields from "./ExecutionOptionsFields";
import LazyInputJsonEditor from "./LazyInputJsonEditor";
import { publishedCurl } from "./publishedCurl";

interface Props {
  preview: PreviewExecution;
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
  onOpenReference: (target: ReferenceTarget) => void;
  onNode: (id: string) => void;
}

/** Presents the editor's preview session; the session state lives in usePreviewExecution. */
export default function TestPanel({
  preview,
  ruleId,
  definition,
  version,
  publishedVersion,
  buildPending,
  inputNodeId,
  onOpenReference,
  onNode,
}: Props) {
  const [inputFocusRequest, setInputFocusRequest] = useState(0);
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
            onClick={preview.run}
            disabled={preview.running || buildPending}
          >
            {preview.running ? "Running…" : "Run test"}
          </Button>
          <IconButton
            aria-label="Close test panel"
            size="small"
            onClick={preview.close}
          >
            <X size={16} />
          </IconButton>
        </div>
      </div>
      <div className="test-panel-content">
        <div className="test-input">
          <ExecutionOptionsFields
            trace={preview.trace}
            timeoutMs={preview.timeoutMs}
            onTrace={preview.setTrace}
            onTimeout={preview.setTimeoutMs}
          />
          <Tabs
            value={preview.inputView}
            onChange={(_, view: PreviewInputView) => preview.setInputView(view)}
          >
            <Tab value="json" label="Input JSON" />
            <Tab value="curl" label="cURL" />
          </Tabs>
          {preview.inputView === "json" ? (
            <LazyInputJsonEditor
              label="Test input JSON"
              value={preview.input}
              onChange={preview.changeInput}
              focusRequest={inputFocusRequest}
            />
          ) : (
            <div className="curl-preview">
              {!publishedVersion && (
                <span>Publish this rule to enable its endpoint.</span>
              )}
              <pre>
                {publishedCurl(ruleId, preview.input, publishedVersion, {
                  trace: preview.trace,
                  timeoutMs: preview.timeoutMs,
                })}
              </pre>
              <small>
                cURL executes the published version. Preview uses the graph
                above.
              </small>
            </div>
          )}
        </div>
        <div className="test-output">
          <PreviewOutput
            preview={preview}
            definition={definition}
            shown={{ ruleId, version }}
            inputNodeId={inputNodeId}
            buildPending={buildPending}
            onNode={onNode}
            onOpenReference={onOpenReference}
            onEditInputs={() => {
              preview.setInputView("json");
              setInputFocusRequest((request) => request + 1);
            }}
          />
        </div>
      </div>
    </div>
  );
}

function PreviewOutput({
  preview,
  definition,
  shown,
  inputNodeId,
  buildPending,
  onNode,
  onOpenReference,
  onEditInputs,
}: {
  preview: PreviewExecution;
  definition: Definition;
  shown: { ruleId: string; version: number | null };
  inputNodeId: string | null;
  buildPending: boolean;
  onNode: (id: string) => void;
  onOpenReference: (target: ReferenceTarget) => void;
  onEditInputs: () => void;
}) {
  if (buildPending)
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
  if (preview.error)
    return (
      <ExecutionError
        error={preview.error}
        problem={preview.problem}
        shown={shown}
        inputNodeId={inputNodeId}
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
