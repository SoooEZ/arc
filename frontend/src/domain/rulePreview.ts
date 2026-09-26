import type { Definition, RuleNode } from "../types";
import { sourcePorts } from "./nodePorts";

export const previewNodeWidth = 132;
export const previewNodeHeight = 40;
const columnGap = 24;
const rowGap = 32;
const padding = 28;

/** A compact topology overview, independent of missing or widely spaced canvas positions. */
export function rulePreview(definition: Definition) {
  const nodesById = new Map(definition.nodes.map((node) => [node.id, node]));
  const incoming = new Map(definition.nodes.map((node) => [node.id, 0]));
  const outgoing = new Map<string, string[]>();
  const edges = definition.edges.filter(
    (edge) => nodesById.has(edge.source) && nodesById.has(edge.target),
  );
  for (const edge of edges) {
    incoming.set(edge.target, incoming.get(edge.target)! + 1);
    const targets = outgoing.get(edge.source) ?? [];
    targets.push(edge.target);
    outgoing.set(edge.source, targets);
  }
  const layers = new Map<string, number>();
  const ready = definition.nodes.filter((node) => incoming.get(node.id) === 0);
  ready.forEach((node) => layers.set(node.id, 0));
  for (let index = 0; index < ready.length; index++) {
    const node = ready[index];
    for (const target of outgoing.get(node.id) ?? []) {
      layers.set(
        target,
        Math.max(layers.get(target) ?? 0, layers.get(node.id)! + 1),
      );
      incoming.set(target, incoming.get(target)! - 1);
      if (incoming.get(target) === 0) ready.push(nodesById.get(target)!);
    }
  }
  // Invalid cyclic drafts still show every node and connection without blocking the library.
  const remainingLayer = layers.size ? Math.max(...layers.values()) + 1 : 0;
  for (const node of definition.nodes) {
    if (incoming.get(node.id)! > 0) layers.set(node.id, remainingLayer);
  }
  const rows = new Map<number, RuleNode[]>();
  for (const node of definition.nodes) {
    const layer = layers.get(node.id) ?? 0;
    const row = rows.get(layer) ?? [];
    row.push(node);
    rows.set(layer, row);
  }
  const columns = Math.max(1, ...[...rows.values()].map((row) => row.length));
  const width =
    columns * (previewNodeWidth + columnGap) - columnGap + padding * 2;
  const height =
    (Math.max(0, ...rows.keys()) + 1) * (previewNodeHeight + rowGap) -
    rowGap +
    padding * 2;
  const nodes = [...rows].flatMap(([layer, row]) => {
    const rowWidth = row.length * (previewNodeWidth + columnGap) - columnGap;
    return row.map((node, column) => ({
      node,
      x: (width - rowWidth) / 2 + column * (previewNodeWidth + columnGap),
      y: padding + layer * (previewNodeHeight + rowGap),
    }));
  });
  const positions = new Map(nodes.map((node) => [node.node.id, node]));
  const connections = edges.map((edge) => {
    const source = positions.get(edge.source)!;
    const target = positions.get(edge.target)!;
    const port = sourcePorts(source.node).find(
      (port) => port.id === edge.sourceHandle,
    );
    const sx = source.x + previewNodeWidth * (port?.ratio ?? 0.5);
    const sy = source.y + previewNodeHeight;
    const tx = target.x + previewNodeWidth / 2;
    const ty = target.y;
    let path: string;
    if (ty > sy) {
      const midY = (sy + ty) / 2;
      path = `M ${sx} ${sy} C ${sx} ${midY}, ${tx} ${midY}, ${tx} ${ty}`;
    } else {
      // Route cycles beside the nodes; the overview bounds include this loop.
      const sideX = Math.max(source.x, target.x) + previewNodeWidth + 20;
      path = `M ${sx} ${sy} C ${sideX} ${sy + 20}, ${sideX} ${ty - 20}, ${tx} ${ty}`;
    }
    return { edge, path, label: port?.label || edge.sourceHandle, sx, sy };
  });
  return {
    nodes,
    connections,
    width,
    height,
    missingConnections: definition.edges.length - edges.length,
  };
}
