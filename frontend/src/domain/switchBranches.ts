import type { Definition, RuleNode } from "../types";
import { nodeWidth } from "./nodePorts";

/** An inline return editor owns only an Output reached exclusively by Default. */
export function switchDefaultOutput(
  definition: Definition,
  switchId: string,
): RuleNode | undefined {
  const edges = definition.edges.filter(
    (edge) => edge.source === switchId && edge.sourceHandle === "default",
  );
  if (edges.length !== 1) return;
  const output = definition.nodes.find(
    (node) => node.id === edges[0].target && node.type === "OUTPUT",
  );
  if (
    !output ||
    definition.edges.some(
      (edge) => edge.target === output.id && edge.id !== edges[0].id,
    )
  )
    return;
  return output;
}

/** Preserve existing routing; adding a return is allowed only for an unconnected Default. */
export function setSwitchDefaultReturn(
  definition: Definition,
  switchId: string,
  expression: string,
  outputId: string,
  edgeId: string,
): Definition {
  const node = definition.nodes.find(
    (item) => item.id === switchId && item.type === "SWITCH",
  );
  if (!node) return definition;
  const output = switchDefaultOutput(definition, switchId);
  if (output)
    return {
      ...definition,
      nodes: definition.nodes.map((item) =>
        item.id === output.id ? { ...item, expression } : item,
      ),
    };
  if (
    definition.nodes.length >= 100 ||
    definition.edges.length >= 200 ||
    definition.edges.some(
      (edge) => edge.source === switchId && edge.sourceHandle === "default",
    ) ||
    definition.nodes.some((item) => item.id === outputId) ||
    definition.edges.some((edge) => edge.id === edgeId)
  )
    return definition;
  // Node labels have a 160 UTF-16-unit limit; do not split a surrogate pair.
  const label = node.label.slice(0, 150).replace(/[\uD800-\uDBFF]$/u, "");
  // Keep the new Output clear of existing cards; Arrange can compact the graph.
  const x = Math.max(
    ...definition.nodes.map((item) => item.position.x + nodeWidth(item) + 50),
  );
  return {
    ...definition,
    nodes: [
      ...definition.nodes,
      {
        id: outputId,
        type: "OUTPUT",
        label: `${label} · Default`,
        expression,
        position: { x, y: node.position.y + 220 },
      },
    ],
    edges: [
      ...definition.edges,
      {
        id: edgeId,
        source: switchId,
        sourceHandle: "default",
        target: outputId,
      },
    ],
  };
}
