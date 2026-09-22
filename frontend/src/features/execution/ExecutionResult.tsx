import { CheckCircle2, ChevronRight, Clock3 } from "lucide-react";
import { NodeIcon } from "../../components/Icons";
import type { Execution } from "../../types";

export default function ExecutionResult({
  result,
  onNode,
}: {
  result: Execution;
  onNode: (id: string) => void;
}) {
  return (
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
              {step.type === "INPUT" ? "received" : JSON.stringify(step.value)}
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
  );
}
