import ELK, { type ElkNode, type ElkPort } from "elkjs/lib/elk.bundled.js";
import type { Definition } from "./types";
import {
  branchHandleX,
  defaultNodeSize,
  type NodeSizes,
} from "./graphGeometry";

const elk = new ELK();
const portId = (nodeId: string, handle: string) => `${nodeId}:${handle}`;
const compareId = (a: { id: string }, b: { id: string }) =>
  a.id.localeCompare(b.id);

/** Arrange presentation coordinates only; edge identities and execution semantics stay intact. */
export async function arrangeGraph(
  definition: Definition,
  sizes: NodeSizes = {},
): Promise<Definition> {
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
    children: [...definition.nodes].sort(compareId).map((node) => {
      const measured = sizes[node.id];
      const width =
        measured?.width > 0 ? measured.width : defaultNodeSize.width;
      const height =
        measured?.height > 0 ? measured.height : defaultNodeSize.height;
      const port = (
        handle: string,
        ratio: number,
        source: boolean,
      ): ElkPort => ({
        id: portId(node.id, handle),
        width: 0,
        height: 0,
        x: width * ratio,
        y: source ? height : 0,
        layoutOptions: { "elk.port.side": source ? "SOUTH" : "NORTH" },
      });
      const ports: ElkPort[] = [];
      if (node.type !== "INPUT") ports.push(port("target", 0.5, false));
      if (node.type === "CONDITION") {
        ports.push(port("true", branchHandleX.true, true));
        ports.push(port("false", branchHandleX.false, true));
      } else if (node.type !== "OUTPUT") ports.push(port("next", 0.5, true));
      return {
        id: node.id,
        width,
        height,
        ports,
        // Fixed positions, rather than free ports, make crossings between the
        // two exits visible to the optimizer. It reorders nodes, never handles.
        layoutOptions: { "elk.portConstraints": "FIXED_POS" },
      };
    }),
    edges: [...definition.edges].sort(compareId).map((edge) => ({
      id: edge.id,
      sources: [portId(edge.source, edge.sourceHandle)],
      targets: [portId(edge.target, "target")],
    })),
  };
  const ports = new Set(
    graph.children!.flatMap((node) => node.ports!.map((p) => p.id)),
  );
  if (
    graph.edges!.some(
      (edge) => !ports.has(edge.sources[0]) || !ports.has(edge.targets[0]),
    )
  )
    throw new Error(
      "Connect edges to valid node handles before arranging the graph.",
    );
  const result = await elk.layout(graph);
  const positions = new Map(
    result.children?.map((node) => [node.id, { x: node.x, y: node.y }]),
  );
  return {
    ...definition,
    nodes: definition.nodes.map((node) => {
      const p = positions.get(node.id);
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y))
        throw new Error(
          "Could not calculate a layout for every node. Your graph is unchanged.",
        );
      return { ...node, position: { x: p.x!, y: p.y! } };
    }),
  };
}
