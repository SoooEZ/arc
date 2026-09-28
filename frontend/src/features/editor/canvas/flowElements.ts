import type { Edge } from "@xyflow/react";
import type { Definition, Execution, RuleNode } from "../../../types";
import { nodeWidth, sourcePorts } from "../../../domain/nodePorts";
import type { FlowNode } from "./GraphNode";
import { defaultNodeSize, type NodeSizes } from "./graphGeometry";

/** A card as an obstacle for edge routing, in flow coordinates. */
export interface CardBounds {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Card bounds from saved positions and measured sizes (default size until measured). */
export function cardBounds(nodes: RuleNode[], sizes: NodeSizes): CardBounds[] {
  return nodes.map((node) => {
    const size = sizes.get(node.id) ?? {
      width: nodeWidth(node),
      height: defaultNodeSize.height,
    };
    return {
      id: node.id,
      x: node.position.x,
      y: node.position.y,
      width: size.width,
      height: size.height,
    };
  });
}

/*
 * React Flow re-renders a card or connection only when its user object
 * changes. Most edits touch one node, so the builders below return the
 * previous object whenever everything it shows is unchanged.
 */

const noErrors: readonly string[] = [];

export interface FlowNodeInputs {
  selected: string;
  visited: ReadonlySet<string>;
  inputCount: number;
  errors: ReadonlyMap<string, readonly string[]>;
  sizes: NodeSizes;
  onExpression: (id: string) => void;
}

export function flowNodes(
  nodes: RuleNode[],
  inputs: FlowNodeInputs,
  previous: ReadonlyMap<string, FlowNode>,
): FlowNode[] {
  return nodes.map((model) => {
    const selected = model.id === inputs.selected;
    const measured = inputs.sizes.get(model.id);
    const data: FlowNode["data"] = {
      model,
      visited: inputs.visited.has(model.id),
      inputCount: inputs.inputCount,
      errors: inputs.errors.get(model.id) ?? noErrors,
      onExpression: inputs.onExpression,
    };
    const earlier = previous.get(model.id);
    if (
      earlier &&
      earlier.selected === selected &&
      earlier.measured === measured &&
      earlier.data.model === data.model &&
      earlier.data.visited === data.visited &&
      earlier.data.inputCount === data.inputCount &&
      earlier.data.errors === data.errors &&
      earlier.data.onExpression === data.onExpression
    )
      return earlier;
    return {
      id: model.id,
      type: "arc",
      position: model.position,
      measured,
      style: { width: nodeWidth(model) },
      selected,
      data,
    };
  });
}

/** Branches taken at the top level of a traced run, as `${nodeId} ${branch}`. */
export function takenBranches(trace: Execution | null): ReadonlySet<string> {
  const taken = new Set<string>();
  for (const step of trace?.trace ?? [])
    if (step.depth === 0 && step.branch !== null)
      taken.add(branchKey(step.nodeId, step.branch));
  return taken;
}
const branchKey = (nodeId: string, branch: string) => `${nodeId} ${branch}`;

const edgeLabelStyles = {
  fallback: { fill: "#956a4a", fontSize: 10, fontWeight: 550 },
  ordinary: { fill: "#47765d", fontSize: 10, fontWeight: 550 },
};
const edgeLabelBackground = { fill: "#f8faf8", fillOpacity: 1 };
const edgeLabelPadding: [number, number] = [5, 3];

function edgeStroke(active: boolean, sourceHandle: string): string {
  if (active) return "#278765";
  return sourceHandle === "false" ? "#b7a696" : "#a5b4ae";
}

export function flowEdges(
  definition: Definition,
  inputs: { selectedEdge: string | null; taken: ReadonlySet<string> },
  previous: ReadonlyMap<string, Edge>,
): Edge[] {
  const nodes = new Map(definition.nodes.map((node) => [node.id, node]));
  return definition.edges.map((edge) => {
    const selected = inputs.selectedEdge === edge.id;
    const active = inputs.taken.has(branchKey(edge.source, edge.sourceHandle));
    const source = nodes.get(edge.source);
    const label =
      (source &&
        sourcePorts(source).find((port) => port.id === edge.sourceHandle)
          ?.label) ||
      undefined;
    const earlier = previous.get(edge.id);
    if (
      earlier &&
      earlier.source === edge.source &&
      earlier.target === edge.target &&
      earlier.sourceHandle === edge.sourceHandle &&
      earlier.selected === selected &&
      earlier.animated === active &&
      earlier.label === label
    )
      return earlier;
    return {
      ...edge,
      type: "routed",
      selected,
      animated: active,
      style: {
        stroke: edgeStroke(active, edge.sourceHandle),
        strokeWidth: active || selected ? 2.3 : 1.6,
      },
      label,
      labelStyle:
        edge.sourceHandle === "false"
          ? edgeLabelStyles.fallback
          : edgeLabelStyles.ordinary,
      labelBgStyle: edgeLabelBackground,
      labelBgPadding: edgeLabelPadding,
    };
  });
}
