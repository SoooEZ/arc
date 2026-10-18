import {
  Handle,
  Position,
  useUpdateNodeInternals,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { Fragment, memo, useEffect, useRef } from "react";
import { AlertCircle, Check, Code2, ExternalLink, Plus } from "lucide-react";
import { Tooltip } from "@mui/material";
import type { NodeType, RuleNode } from "../../../types";
import { NodeIcon } from "../../../components/Icons";
import { nodeKinds } from "../../../domain/nodeKinds";
import { messageForNode } from "../../../domain/text";
import {
  hasTargetPort,
  nodeMinHeight,
  nodeWidth,
  sourcePorts,
  type LayoutDirection,
} from "../../../domain/nodePorts";

export type FlowNode = Node<
  {
    model: RuleNode;
    visited: boolean;
    inputCount: number;
    errors: readonly string[];
    /** Shared by every card, so an unchanged card keeps its data object. */
    onExpression: (id: string) => void;
    /** False while a document command runs, like the context menu's actions. */
    canOpenCode: boolean;
    /** Offers the kinds to add after exit `handle` of node `id`, anchored at its button. */
    onAddAfter: (id: string, handle: string, anchor: HTMLElement) => void;
    /** The draft is editable and has room for a node and a connection. */
    canAddAfter: boolean;
    /** The exits with a connection, one handle per line (text, so an unchanged card keeps its data). */
    connectedExits: string;
    /** Top to bottom: enters at the top, exits along the bottom; left to right: enters left, exits right. */
    direction: LayoutDirection;
  },
  "arc"
>;

/** Where a card's handles and exit captions go in each drawing direction. */
const handlePlaces: Record<
  LayoutDirection,
  {
    target: Position;
    source: Position;
    offset: "left" | "top";
    captionClass: string;
    /** Places an exit's add button past its caption. */
    addClass: string;
  }
> = {
  vertical: {
    target: Position.Top,
    source: Position.Bottom,
    offset: "left",
    captionClass: "",
    addClass: "exit-add-below",
  },
  horizontal: {
    target: Position.Left,
    source: Position.Right,
    offset: "top",
    captionClass: "handle-caption-side",
    addClass: "exit-add-side",
  },
};
/**
 * A card renders only when its own node object, selection, errors or trace
 * status changes: flowElements keeps the data object of an unchanged card, and
 * the memo keeps every other card out of an edit's render.
 */
export default memo(GraphNode);

function GraphNode({ data, selected }: NodeProps<FlowNode>) {
  const n = data.model;
  const kind = nodeKinds[n.type];
  const ports = sourcePorts(n);
  const place = handlePlaces[data.direction];
  const connected = new Set(data.connectedExits.split("\n"));
  // Handles move when the exits or the drawing direction change.
  const portKey = `${data.direction}:${ports.map((port) => port.id).join(",")}`;
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
      style={{
        width: nodeWidth(n, data.direction),
        minHeight: nodeMinHeight(n, data.direction) || undefined,
      }}
    >
      {hasTargetPort(n) && <Handle type="target" position={place.target} />}
      <div className="node-type-line">
        <span className={`node-icon ${kind.className}`}>
          <NodeIcon type={n.type} size={14} />
        </span>
        {/* The first problem takes the kind's place (the icon still names
            the kind): the card keeps its size and its summary, and the
            badge stays clear of the incoming handle. */}
        {data.errors.length ? (
          <span className="node-type-problem">
            {messageForNode(data.errors[0], n.label)}
          </span>
        ) : (
          <span>{kind.label}</span>
        )}
        <div className="node-header-actions">
          <Tooltip title="View or edit the whole node expression">
            <button
              className="node-expression-button nodrag nopan"
              aria-label={`Node expression · ${n.label}`}
              disabled={!data.canOpenCode}
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
            <span>
              {data.errors.length === 1
                ? "Error"
                : `${data.errors.length} errors`}
            </span>
          </div>
        </Tooltip>
      )}
      {ports.map((port) => (
        <Fragment key={port.id}>
          <Handle
            type="source"
            position={place.source}
            id={port.id}
            style={{ [place.offset]: `${port.ratio * 100}%` }}
            aria-label={`${n.label} · ${port.label || "Next"}`}
          />
          {port.label && (
            <span
              title={port.label}
              className={`handle-label handle-caption ${place.captionClass} ${port.fallback ? "handle-fallback" : ""}`}
              style={{ [place.offset]: `${port.ratio * 100}%` }}
            >
              {port.label}
            </span>
          )}
          {data.canAddAfter && !connected.has(port.id) && (
            <button
              className={`exit-add nodrag nopan ${place.addClass}`}
              style={{ [place.offset]: `${port.ratio * 100}%` }}
              aria-label={`Add after ${n.label} · ${port.label || "Next"}`}
              title={`Add a step after ${port.label || n.label}`}
              onClick={(event) => {
                event.stopPropagation();
                data.onAddAfter(n.id, port.id, event.currentTarget);
              }}
            >
              <Plus size={12} />
            </button>
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
