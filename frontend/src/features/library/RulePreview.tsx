import { ArrowRight } from "lucide-react";
import type { Rule } from "../../types";
import { NodeIcon } from "../../components/Icons";

export default function RulePreview({ rule }: { rule: Rule }) {
  const { nodes, edges, inputs } = rule.draft;
  const condition = nodes.find((n) => n.type === "CONDITION");
  const input = nodes.find((n) => n.type === "INPUT");
  const formula =
    nodes.find((n) => n.type === "FORMULA") ||
    nodes.find((n) => n.type === "OUTPUT");
  const branches = ["true", "false"].map((branch) =>
    nodes.find(
      (n) =>
        n.id ===
        edges.find(
          (e) => e.source === condition?.id && e.sourceHandle === branch,
        )?.target,
    ),
  );
  return (
    <div
      className={`mini-graph mini-${rule.kind.toLowerCase()}`}
      aria-hidden="true"
    >
      {condition ? (
        <>
          {rule.kind === "DECISION_TREE" && (
            <>
              <div className="mini-box mini-input">
                <span />
                {input?.label || "Inputs"}
              </div>
              <div className="mini-stem" />
            </>
          )}
          <div className="mini-box mini-condition">
            <NodeIcon type="CONDITION" size={12} />
            {condition.label}
          </div>
          <div className="mini-branch">
            <span>True</span>
            <span>False</span>
          </div>
          <div className="mini-row">
            {branches.map((node, i) => (
              <div
                key={i}
                className={`mini-box ${node?.type === "REFERENCE" ? "mini-reuse" : node?.type === "CONDITION" ? "mini-condition" : "mini-output"}`}
              >
                {node && <NodeIcon type={node.type} size={12} />}
                <span>{node?.label || "Not connected"}</span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="formula-preview">
            <span>ƒ</span>
            <code title={formula?.expression || ""}>
              {formula?.expression || "Connect your logic"}
            </code>
          </div>
          <div className="formula-caption">
            {inputs.slice(0, 2).map((p) => (
              <span key={p.name}>{p.name}</span>
            ))}
            <ArrowRight size={13} />
            <strong>{formula?.output || "result"}</strong>
          </div>
        </>
      )}
    </div>
  );
}
