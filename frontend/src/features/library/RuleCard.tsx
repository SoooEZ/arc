import { useState } from "react";
import { ruleApi } from "../../api/rules";
import { useAsyncResource } from "../../hooks/useAsyncResource";
import { Button, Chip } from "@mui/material";
import { ArrowUpRight, RotateCcw } from "lucide-react";
import type { RuleSummary, Rule } from "../../types";
import { kindLabel } from "../../types";
import { KindIcon } from "../../components/Icons";
import RulePreview from "./RulePreview";

export default function RuleCard({
  rule,
  onOpen,
}: {
  rule: RuleSummary;
  onOpen: (rule: RuleSummary) => void;
}) {
  const [attempt, setAttempt] = useState(0);
  // Only mounted cards on the current catalog page fetch; unmount aborts old previews.
  const detail = useAsyncResource(
    `${rule.id}:${rule.revision}:${attempt}`,
    (signal) => ruleApi.get(rule.id, { signal }),
    null as Rule | null,
  );
  return (
    <article className="rule-card">
      <div className="rule-card-top">
        <span className={`kind-icon ${rule.kind.toLowerCase()}`}>
          <KindIcon kind={rule.kind} />
        </span>
        <Chip
          size="small"
          className={rule.publishedVersion ? "published-chip" : "draft-chip"}
          label={
            rule.publishedVersion
              ? `Published · v${rule.publishedVersion}`
              : "Draft"
          }
        />
      </div>
      <div className="rule-card-title">
        <h3>{rule.name}</h3>
      </div>
      <p>
        {rule.description ||
          "Add a description to explain what this rule does."}
      </p>
      {detail.data ? (
        <RulePreview rule={detail.data} />
      ) : (
        <div className="rule-preview">
          <div className="mini-graph preview-state" aria-live="polite">
            {detail.error ? (
              <>
                <span>Graph preview unavailable</span>
                <small>{detail.error}</small>
                <Button
                  className="preview-retry"
                  size="small"
                  startIcon={<RotateCcw size={13} />}
                  onClick={() => setAttempt((value) => value + 1)}
                >
                  Retry preview
                </Button>
              </>
            ) : (
              <span>Loading graph…</span>
            )}
          </div>
          <div className="rule-preview-caption">Current draft</div>
        </div>
      )}
      <div className="rule-card-footer">
        <span>{kindLabel[rule.kind]}</span>
        <span>
          {rule.nodeCount} {rule.nodeCount === 1 ? "node" : "nodes"}
          <span className="tiny-divider" />
          {rule.inputCount} {rule.inputCount === 1 ? "input" : "inputs"}
        </span>
      </div>
      <button
        className="rule-card-open"
        aria-label={`Open graph: ${rule.name}`}
        onClick={() => onOpen(rule)}
      >
        <span>
          Open graph <ArrowUpRight size={14} />
        </span>
      </button>
    </article>
  );
}
