import ELK, {
  type ElkExtendedEdge,
  type ElkNode,
  type ElkPort,
} from "elkjs/lib/elk.bundled.js";
import type { Definition, RuleNode } from "../../../types";
import { defaultNodeSize, type NodeSizes } from "./graphGeometry";
import {
  hasTargetPort,
  nodeWidth,
  sourcePorts,
} from "../../../domain/nodePorts";

const elk = new ELK();
const portId = (nodeId: string, handle: string) => `${nodeId}:${handle}`;
const compareId = (a: { id: string }, b: { id: string }) =>
  a.id.localeCompare(b.id);
const isFiniteNumber = (value: number | undefined): value is number =>
  value !== undefined && Number.isFinite(value);

/** One layout box per node, with ports where GraphNode draws its handles. */
function layoutNode(node: RuleNode, sizes: NodeSizes) {
  const measured = sizes.get(node.id);
  const width =
    measured && measured.width > 0 ? measured.width : nodeWidth(node);
  const height =
    measured && measured.height > 0 ? measured.height : defaultNodeSize.height;
  const port = (handle: string, ratio: number, source: boolean): ElkPort => ({
    id: portId(node.id, handle),
    width: 0,
    height: 0,
    x: width * ratio,
    y: source ? height : 0,
    layoutOptions: { "elk.port.side": source ? "SOUTH" : "NORTH" },
  });
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

/** Arrange presentation coordinates only; edge identities and execution semantics stay intact. */
export async function arrangeGraph(
  definition: Definition,
  sizes: NodeSizes = new Map(),
): Promise<Definition> {
  const children = [...definition.nodes]
    .sort(compareId)
    .map((node) => layoutNode(node, sizes));
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
      "elk.direction": "DOWN",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.spacing.nodeNode": "65",
      "elk.layered.spacing.nodeNodeBetweenLayers": "80",
      "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
      "elk.randomSeed": "1",
      "elk.layered.thoroughness": "20",
      "elk.padding": "[top=30,left=30,bottom=30,right=30]",
    },
    children,
    edges,
  };
  const result = await elk.layout(graph);
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
