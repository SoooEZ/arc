import { memo, useMemo } from "react";
import { CheckCircle2, ChevronRight } from "lucide-react";
import { NodeIcon } from "../../components/Icons";
import type { Definition, Execution, Step } from "../../types";
import { semanticGraphKey } from "../../domain/graph";
import { stringifyJson } from "../../domain/json";
import { fixedExitCaption, handles, sourcePort } from "../../domain/nodePorts";
import ExecutionTiming from "./ExecutionTiming";
import TraceNotices from "./TraceNotices";

/**
 * The badge a traced branch shows: the exit's caption for this graph's nodes;
 * for a nested rule's steps, whose graph is not here, the fixed exits (True,
 * False, Default) caption themselves. The `next` exit and a case handle
 * without its node show no badge.
 */
export function branchBadge(
  step: Step,
  definition: Definition,
): { text: string; fallback: boolean } | null {
  if (step.branch === null || step.branch === handles.next) return null;
  const node =
    step.depth === 0
      ? definition.nodes.find((candidate) => candidate.id === step.nodeId)
      : undefined;
  const port = node && sourcePort(node, step.branch);
  if (port)
    return port.label ? { text: port.label, fallback: port.fallback } : null;
  const fixed = fixedExitCaption(step.branch);
  return fixed && { text: fixed.label, fallback: fixed.fallback };
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
  // Branch badges read the graph's structure, not its positions, so the key
  // `structure` stands for `definition`: a drag re-rendered every step of a
  // 1,000-step trace on each frame.
  const structure = semanticGraphKey(definition);
  const badges = useMemo(
    () => result.trace.map((step) => branchBadge(step, definition)),
    [result.trace, structure],
  );
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
      <TraceSteps trace={result.trace} badges={badges} onNode={onNode} />
    </>
  );
}

/** The trace rows; they render again only for another trace, its badges or its handler. */
const TraceSteps = memo(function TraceSteps({
  trace,
  badges,
  onNode,
}: {
  trace: Execution["trace"];
  badges: ReturnType<typeof branchBadge>[];
  onNode: (id: string) => void;
}) {
  return (
    <div className="trace-list">
      {trace.map((step, i) => {
        const badge = badges[i];
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
  );
});
