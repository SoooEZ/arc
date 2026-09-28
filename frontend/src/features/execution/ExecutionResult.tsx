import { CheckCircle2, ChevronRight } from "lucide-react";
import { NodeIcon } from "../../components/Icons";
import type { Definition, Execution, Step } from "../../types";
import { stringifyJson } from "../../domain/json";
import { sourcePort } from "../../domain/nodePorts";
import ExecutionTiming from "./ExecutionTiming";
import TraceNotices from "./TraceNotices";

/** The badge a traced branch shows: the exit's caption for this graph's nodes, the raw handle elsewhere. */
export function branchBadge(
  step: Step,
  definition: Definition,
): { text: string; fallback: boolean } | null {
  if (step.branch === null) return null;
  const node =
    step.depth === 0
      ? definition.nodes.find((candidate) => candidate.id === step.nodeId)
      : undefined;
  const port = node && sourcePort(node, step.branch);
  if (!port) return { text: step.branch, fallback: false };
  if (!port.label) return null;
  return { text: port.label, fallback: port.fallback };
}

export default function ExecutionResult({
  result,
  definition,
  onNode,
  requestDurationMs,
}: {
  result: Execution;
  /** The shown graph, whose exits name the traced branches. */
  definition: Definition;
  onNode: (id: string) => void;
  requestDurationMs: number | null;
}) {
  return (
    <>
      <div className="test-result">
        <span>
          <CheckCircle2 size={15} />
          Result
        </span>
        <strong data-testid="test-result">
          {stringifyJson(result.result)}
        </strong>
      </div>
      <ExecutionTiming result={result} requestDurationMs={requestDurationMs} />
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
      <TraceNotices result={result} graphHighlights />
      <div className="trace-label">
        EXECUTION TRACE{" "}
        <span>
          {result.trace.length} recorded /{" "}
          {result.executedSteps ?? result.trace.length} executed
        </span>
      </div>
      <div className="trace-list">
        {result.trace.map((step, i) => {
          const badge = branchBadge(step, definition);
          return (
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
                {step.type === "INPUT" ? "received" : stringifyJson(step.value)}
              </code>
              {badge ? (
                <span
                  className={`trace-branch ${badge.fallback ? "fallback" : ""}`}
                >
                  {badge.text}
                </span>
              ) : (
                <ChevronRight size={12} />
              )}
            </button>
          );
        })}
      </div>
    </>
  );
}
