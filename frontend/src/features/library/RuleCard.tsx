import { useState } from "react";
import { ruleApi } from "../../api/rules";
import { useAsyncResource } from "../../hooks/useAsyncResource";
import { Chip } from "@mui/material";
import { ArrowUpRight } from "lucide-react";
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
  const [preview, setPreview] = useState(false);
  const detail = useAsyncResource(
    rule.id + ":" + rule.revision,
    (signal) => ruleApi.get(rule.id, { signal }),
    null as Rule | null,
    150,
    preview,
  );
  return (
    <button
      className="rule-card"
      onMouseEnter={() => setPreview(true)}
      onFocus={() => setPreview(true)}
      onClick={() => onOpen(rule)}
    >
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
        <ArrowUpRight size={17} />
      </div>
      <p>
        {rule.description ||
          "Add a description to explain what this rule does."}
      </p>
      {detail.data ? (
        <RulePreview rule={detail.data} />
      ) : (
        <div className="mini-graph">
          <span>{kindLabel[rule.kind]} · hover or focus for graph preview</span>
        </div>
      )}
      <div className="rule-card-footer">
        <span>{kindLabel[rule.kind]}</span>
        <span>
          {rule.nodeCount} nodes
          <span className="tiny-divider" />
          {rule.inputCount} inputs
        </span>
      </div>
    </button>
  );
}
