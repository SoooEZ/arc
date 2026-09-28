import type { Definition, RuleNode } from "../types";
import { canAddEdge, canAddNode, MAX_LABEL_CHARACTERS } from "./limits";
import { handles, nodeWidth } from "./nodePorts";

/** An inline return editor owns only an Output reached exclusively by Default. */
export function switchDefaultOutput(
  definition: Definition,
  switchId: string,
): RuleNode | undefined {
  const edges = definition.edges.filter(
    (edge) => edge.source === switchId && edge.sourceHandle === handles.default,
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

/**
 * Whether a Default return can be added: the Default exit is unconnected and
 * the draft has room for the Output and its connection. The button and the
 * updater read the same rule.
 */
export function canAddSwitchDefaultReturn(
  definition: Definition,
  switchId: string,
): boolean {
  return (
    canAddNode(definition) &&
    canAddEdge(definition) &&
    !definition.edges.some(
      (edge) =>
        edge.source === switchId && edge.sourceHandle === handles.default,
    )
  );
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
    !canAddSwitchDefaultReturn(definition, switchId) ||
    definition.nodes.some((item) => item.id === outputId) ||
    definition.edges.some((edge) => edge.id === edgeId)
  )
    return definition;
  // The label keeps room for its suffix within the label limit (UTF-16 units);
  // the cut does not split a surrogate pair.
  const suffix = " · Default";
  const label = node.label
    .slice(0, MAX_LABEL_CHARACTERS - suffix.length)
    .replace(/[\uD800-\uDBFF]$/u, "");
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
        label: `${label}${suffix}`,
        expression,
        position: { x, y: node.position.y + 220 },
      },
    ],
    edges: [
      ...definition.edges,
      {
        id: edgeId,
        source: switchId,
        sourceHandle: handles.default,
        target: outputId,
      },
    ],
  };
}
