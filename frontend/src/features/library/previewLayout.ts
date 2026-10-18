import type { Definition, RuleNode } from "../../types";
import { sourcePort, type LayoutDirection } from "../../domain/nodePorts";

export const previewNodeWidth = 132;
export const previewNodeHeight = 40;
const columnGap = 24;
const rowGap = 32;
const padding = 28;

/**
 * A compact topology overview, independent of missing or widely spaced canvas
 * positions. Layers are rows top to bottom, or columns left to right.
 */
export function rulePreview(
  definition: Definition,
  direction: LayoutDirection = "vertical",
) {
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
  const horizontal = direction === "horizontal";
  const widest = Math.max(1, ...[...rows.values()].map((row) => row.length));
  const depth = Math.max(0, ...rows.keys()) + 1;
  // Along a layer, nodes sit side by side (rows) or stacked (columns).
  const across = horizontal
    ? previewNodeHeight + rowGap
    : previewNodeWidth + columnGap;
  const along = horizontal
    ? previewNodeWidth + rowGap * 2
    : previewNodeHeight + rowGap;
  const layerSpan = (count: number, step: number, gap: number) =>
    count * step - gap;
  const width = horizontal
    ? layerSpan(depth, along, rowGap * 2) + padding * 2
    : layerSpan(widest, across, columnGap) + padding * 2;
  const height = horizontal
    ? layerSpan(widest, across, rowGap) + padding * 2
    : layerSpan(depth, along, rowGap) + padding * 2;
  const nodes = [...rows].flatMap(([layer, row]) => {
    if (horizontal) {
      const columnHeight = layerSpan(row.length, across, rowGap);
      return row.map((node, index) => ({
        node,
        x: padding + layer * along,
        y: (height - columnHeight) / 2 + index * across,
      }));
    }
    const rowWidth = layerSpan(row.length, across, columnGap);
    return row.map((node, index) => ({
      node,
      x: (width - rowWidth) / 2 + index * across,
      y: padding + layer * along,
    }));
  });
  const positions = new Map(nodes.map((node) => [node.node.id, node]));
  const connections = edges.map((edge) => {
    const source = positions.get(edge.source)!;
    const target = positions.get(edge.target)!;
    const port = sourcePort(source.node, edge.sourceHandle);
    const ratio = port?.ratio ?? 0.5;
    const { d, sx, sy } = horizontal
      ? sidewaysPath(source, target, ratio)
      : downwardPath(source, target, ratio);
    // A port's label; the `next` exit has none, and an unknown handle cannot reach here.
    return { edge, path: d, label: port?.label ?? "", sx, sy };
  });
  return {
    nodes,
    connections,
    width,
    height,
    missingConnections: definition.edges.length - edges.length,
  };
}

interface Placed {
  x: number;
  y: number;
}

/** A connection from a bottom exit to the top centre; a cycle loops out to the right. */
function downwardPath(source: Placed, target: Placed, ratio: number) {
  const sx = source.x + previewNodeWidth * ratio;
  const sy = source.y + previewNodeHeight;
  const tx = target.x + previewNodeWidth / 2;
  const ty = target.y;
  if (ty > sy) {
    const midY = (sy + ty) / 2;
    return {
      sx,
      sy,
      d: `M ${sx} ${sy} C ${sx} ${midY}, ${tx} ${midY}, ${tx} ${ty}`,
    };
  }
  // Route cycles beside the nodes; the overview bounds include this loop.
  const sideX = Math.max(source.x, target.x) + previewNodeWidth + 20;
  return {
    sx,
    sy,
    d: `M ${sx} ${sy} C ${sideX} ${sy + 20}, ${sideX} ${ty - 20}, ${tx} ${ty}`,
  };
}

/** A connection from a right-edge exit to the left middle; a cycle loops out below. */
function sidewaysPath(source: Placed, target: Placed, ratio: number) {
  const sx = source.x + previewNodeWidth;
  const sy = source.y + previewNodeHeight * ratio;
  const tx = target.x;
  const ty = target.y + previewNodeHeight / 2;
  if (tx > sx) {
    const midX = (sx + tx) / 2;
    return {
      sx,
      sy,
      d: `M ${sx} ${sy} C ${midX} ${sy}, ${midX} ${ty}, ${tx} ${ty}`,
    };
  }
  const sideY = Math.max(source.y, target.y) + previewNodeHeight + 20;
  return {
    sx,
    sy,
    d: `M ${sx} ${sy} C ${sx + 20} ${sideY}, ${tx - 20} ${sideY}, ${tx} ${ty}`,
  };
}
