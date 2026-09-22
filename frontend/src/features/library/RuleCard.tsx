import { Chip } from "@mui/material";
import { ArrowUpRight } from "lucide-react";
import type { Rule } from "../../types";
import { kindLabel } from "../../types";
import { KindIcon } from "../../components/Icons";
import RulePreview from "./RulePreview";
export default function RuleCard({
  rule,
  onOpen,
}: {
  rule: Rule;
  onOpen: (rule: Rule) => void;
}) {
  return (
    <button className="rule-card" onClick={() => onOpen(rule)}>
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
      <RulePreview rule={rule} />
      <div className="rule-card-footer">
        <span>{kindLabel[rule.kind]}</span>
        <span>
          {rule.draft.nodes.length} nodes
          <span className="tiny-divider" />
          {rule.draft.inputs.length} inputs
        </span>
      </div>
    </button>
  );
}
