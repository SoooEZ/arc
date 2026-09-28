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
import type { NodeType, RuleNode } from "../../../types";
import { NodeIcon } from "../../../components/Icons";
import { nodeKinds } from "../../../domain/nodeKinds";
import {
  hasTargetPort,
  nodeWidth,
  sourcePorts,
} from "../../../domain/nodePorts";

export type FlowNode = Node<
  {
    model: RuleNode;
    visited: boolean;
    inputCount: number;
    errors: readonly string[];
    /** Shared by every card, so an unchanged card keeps its data object. */
    onExpression: (id: string) => void;
  },
  "arc"
>;
export default function GraphNode({ data, selected }: NodeProps<FlowNode>) {
  const n = data.model;
  const kind = nodeKinds[n.type];
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
      className={`graph-node node-${kind.className} ${selected ? "node-selected" : ""} ${data.visited ? "node-visited" : ""} ${data.errors.length ? "node-error" : ""}`}
      style={{ width: nodeWidth(n) }}
    >
      {hasTargetPort(n) && <Handle type="target" position={Position.Top} />}
      <div className="node-type-line">
        <span className={`node-icon ${kind.className}`}>
          <NodeIcon type={n.type} size={14} />
        </span>
        <span>{kind.label}</span>
        <div className="node-header-actions">
          <Tooltip title="View or edit the whole node expression">
            <button
              className="node-expression-button nodrag nopan"
              aria-label={`Node expression · ${n.label}`}
              onClick={(e) => {
                e.stopPropagation();
                data.onExpression(n.id);
              }}
            >
              <Code2 size={13} />
            </button>
          </Tooltip>
          <NodeStatusIcon visited={data.visited} type={n.type} />
        </div>
      </div>
      <strong>{n.label}</strong>
      <div className="node-detail">{kind.summary(n, data.inputCount)}</div>
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
              className={`handle-label handle-caption ${port.fallback ? "handle-fallback" : ""}`}
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

/** A visited card shows a check; otherwise a Reference shows that it opens another rule. */
function NodeStatusIcon({
  visited,
  type,
}: {
  visited: boolean;
  type: NodeType;
}) {
  if (visited) return <Check size={13} className="node-check" />;
  if (type === "REFERENCE")
    return <ExternalLink size={12} className="node-link-icon" />;
  return null;
}
