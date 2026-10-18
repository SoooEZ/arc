import type { ElkExtendedEdge, ElkNode, ElkPort } from "elkjs/lib/elk-api.js";
import type { Definition, RuleNode } from "../../../types";
import { cardSize, type NodeSizes } from "./graphGeometry";
import {
  hasTargetPort,
  sourcePorts,
  type LayoutDirection,
} from "../../../domain/nodePorts";

/** Lays out an ELK graph: the worker-backed instance in the browser, the bundled one in tests. */
export type ElkLayout = (graph: ElkNode) => Promise<ElkNode>;

const portId = (nodeId: string, handle: string) => `${nodeId}:${handle}`;
/**
 * Code-unit order: IDs are ASCII, and localeCompare made the layout depend on the browser
 * locale (da-DK sorts "aa" after "z"; th-TH ignores '-' and '_'), so collaborators rewrote each
 * other's card positions.
 */
function compareId(a: { id: string }, b: { id: string }): number {
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}
const isFiniteNumber = (value: number | undefined): value is number =>
  value !== undefined && Number.isFinite(value);

/**
 * Where GraphNode draws a card's handles: the incoming one at the middle of the
 * top (left) edge, exits along the bottom (right) edge at their ratio.
 */
function portPlace(
  direction: LayoutDirection,
  size: { width: number; height: number },
  ratio: number,
  source: boolean,
) {
  if (direction === "horizontal")
    return {
      x: source ? size.width : 0,
      y: size.height * ratio,
      side: source ? "EAST" : "WEST",
    };
  return {
    x: size.width * ratio,
    y: source ? size.height : 0,
    side: source ? "SOUTH" : "NORTH",
  };
}

/** One layout box per node, with ports where GraphNode draws its handles. */
function layoutNode(
  node: RuleNode,
  sizes: NodeSizes,
  direction: LayoutDirection,
) {
  const { width, height } = cardSize(node, sizes, direction);
  const port = (handle: string, ratio: number, source: boolean): ElkPort => {
    const place = portPlace(direction, { width, height }, ratio, source);
    return {
      id: portId(node.id, handle),
      width: 0,
      height: 0,
      x: place.x,
      y: place.y,
      layoutOptions: { "elk.port.side": place.side },
    };
  };
  const ports: ElkPort[] = [];
  if (hasTargetPort(node)) ports.push(port("target", 0.5, false));
  for (const exit of sourcePorts(node))
    ports.push(port(exit.id, exit.ratio, true));
  return {
    id: node.id,
    width,
    height,
    ports,
    // Fixed positions, rather than free ports, make crossings between the
    // two exits visible to the optimizer. It reorders nodes, never handles.
    layoutOptions: { "elk.portConstraints": "FIXED_POS" },
  };
}

/**
 * Arrange presentation coordinates only; edge identities and execution
 * semantics stay intact. Arrange lays the stored, top-to-bottom drawing out;
 * the left-to-right view lays itself out for display (useHorizontalLayout).
 */
export async function arrangeGraph(
  definition: Definition,
  sizes: NodeSizes,
  layout: ElkLayout,
  direction: LayoutDirection = "vertical",
): Promise<Definition> {
  const children = [...definition.nodes]
    .sort(compareId)
    .map((node) => layoutNode(node, sizes, direction));
  const edges: ElkExtendedEdge[] = [...definition.edges]
    .sort(compareId)
    .map((edge) => ({
      id: edge.id,
      sources: [portId(edge.source, edge.sourceHandle)],
      targets: [portId(edge.target, "target")],
    }));
  const ports = new Set(
    children.flatMap((node) => node.ports.map((port) => port.id)),
  );
  if (
    edges.some(
      (edge) => !ports.has(edge.sources[0]) || !ports.has(edge.targets[0]),
    )
  )
    throw new Error(
      "Connect edges to valid node handles before arranging the graph.",
    );
  const graph: ElkNode = {
    id: "arc-layout",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": direction === "horizontal" ? "RIGHT" : "DOWN",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.spacing.nodeNode": "65",
      // Exit captions sit beside a card's right edge, between the layers.
      "elk.layered.spacing.nodeNodeBetweenLayers":
        direction === "horizontal" ? "120" : "80",
      "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
      "elk.randomSeed": "1",
      "elk.layered.thoroughness": "20",
      "elk.padding": "[top=30,left=30,bottom=30,right=30]",
    },
    children,
    edges,
  };
  const result = await layout(graph);
  const positions = new Map<string, { x: number; y: number }>();
  for (const { id, x, y } of result.children ?? [])
    if (isFiniteNumber(x) && isFiniteNumber(y)) positions.set(id, { x, y });
  return {
    ...definition,
    nodes: definition.nodes.map((node) => {
      const position = positions.get(node.id);
      if (!position)
        throw new Error(
          "Could not calculate a layout for every node. Your graph is unchanged.",
        );
      return { ...node, position };
    }),
  };
}
