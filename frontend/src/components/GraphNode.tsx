import {
  Handle,
  Position,
  useUpdateNodeInternals,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { Fragment, useEffect, useRef } from "react";
import { AlertCircle, Check, Code2, ExternalLink } from "lucide-react";
import { Tooltip } from "@mui/material";
import type { RuleNode } from "../types";
import { nodeLabel } from "../types";
import { NodeIcon } from "./Icons";
import { nodeWidth, sourcePorts } from "../domain/nodePorts";

export type FlowNode = Node<
  {
    model: RuleNode;
    visited: boolean;
    inputCount: number;
    errors: string[];
    onExpression: () => void;
  },
  "arc"
>;
export default function GraphNode({ data, selected }: NodeProps<FlowNode>) {
  const n = data.model;
  const ports = sourcePorts(n);
  const portKey = ports.map((port) => port.id).join(",");
  const updateInternals = useUpdateNodeInternals();
  const previousPorts = useRef(portKey);
  useEffect(() => {
    // Initial measurement belongs to React Flow; forcing it per node can fit
    // the viewport before the rest of the graph has been measured.
    if (previousPorts.current !== portKey) {
      previousPorts.current = portKey;
      updateInternals(n.id);
    }
  }, [n.id, portKey, updateInternals]);
  return (
    <div
      className={`graph-node node-${n.type.toLowerCase()} ${selected ? "node-selected" : ""} ${data.visited ? "node-visited" : ""} ${data.errors.length ? "node-error" : ""}`}
      style={{ width: nodeWidth(n) }}
    >
      {n.type !== "INPUT" && <Handle type="target" position={Position.Top} />}
      <div className="node-type-line">
        <span className={`node-icon ${n.type.toLowerCase()}`}>
          <NodeIcon type={n.type} size={14} />
        </span>
        <span>{nodeLabel[n.type]}</span>
        <Tooltip title="View or edit the whole node expression">
          <button
            className="node-expression-button nodrag nopan"
            aria-label={`Node expression · ${n.label}`}
            onClick={(e) => {
              e.stopPropagation();
              data.onExpression();
            }}
          >
            <Code2 size={13} />
          </button>
        </Tooltip>
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
            : n.type === "SWITCH"
              ? `${n.cases?.length ?? 0} cases · first match + default`
              : n.type === "TRANSFORM" && n.fields?.length
                ? `${n.fields.length} fields → ${n.output || "data"}`
                : n.expression || "Add an expression"}
      </div>
      {!!data.errors.length && (
        <Tooltip
          title={
            <div>
              {data.errors.map((error, i) => (
                <div key={i}>{error}</div>
              ))}
            </div>
          }
          arrow
        >
          <div className="node-error-message" role="status">
            <AlertCircle size={13} />
            <span>Error</span>
          </div>
        </Tooltip>
      )}
      {ports.map((port) => (
        <Fragment key={port.id}>
          <Handle
            type="source"
            position={Position.Bottom}
            id={port.id}
            style={{ left: `${port.ratio * 100}%` }}
            aria-label={`${n.label} · ${port.label || "Next"}`}
          />
          {port.label && (
            <span
              title={port.label}
              className={`handle-label handle-caption ${port.id === "false" || port.id === "default" ? "handle-fallback" : ""}`}
              style={{ left: `${port.ratio * 100}%` }}
            >
              {port.label}
            </span>
          )}
        </Fragment>
      ))}
    </div>
  );
}
