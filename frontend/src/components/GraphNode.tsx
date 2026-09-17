import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { Check, ExternalLink } from "lucide-react";
import type { RuleNode } from "../types";
import { nodeLabel } from "../types";
import { NodeIcon } from "./Icons";
import { branchHandleX } from "../graphGeometry";

export type FlowNode = Node<
  { model: RuleNode; visited: boolean; inputCount: number },
  "arc"
>;
export default function GraphNode({ data, selected }: NodeProps<FlowNode>) {
  const n = data.model;
  return (
    <div
      className={`graph-node node-${n.type.toLowerCase()} ${selected ? "node-selected" : ""} ${data.visited ? "node-visited" : ""}`}
    >
      {n.type !== "INPUT" && <Handle type="target" position={Position.Top} />}
      <div className="node-type-line">
        <span className={`node-icon ${n.type.toLowerCase()}`}>
          <NodeIcon type={n.type} size={14} />
        </span>
        <span>{nodeLabel[n.type]}</span>
        {data.visited ? (
          <Check size={13} className="node-check" />
        ) : n.type === "REFERENCE" ? (
          <ExternalLink size={12} className="node-link-icon" />
        ) : null}
      </div>
      <strong>{n.label}</strong>
      <div className="node-detail">
        {n.type === "INPUT"
          ? `${data.inputCount} input parameters`
          : n.type === "REFERENCE"
            ? `${n.ruleId || "Select a rule"}${n.version ? ` · v${n.version}` : ""}`
            : n.expression || "Add an expression"}
      </div>
      {n.type === "CONDITION" ? (
        <>
          <Handle
            type="source"
            position={Position.Bottom}
            id="true"
            style={{
              left: `${branchHandleX.true * 100}%`,
              background: "#348c6a",
            }}
          />
          <span className="handle-label handle-true">True</span>
          <Handle
            type="source"
            position={Position.Bottom}
            id="false"
            style={{
              left: `${branchHandleX.false * 100}%`,
              background: "#bd8262",
            }}
          />
          <span className="handle-label handle-false">False</span>
        </>
      ) : n.type !== "OUTPUT" ? (
        <Handle type="source" position={Position.Bottom} id="next" />
      ) : null}
    </div>
  );
}
