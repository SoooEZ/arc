import type { BranchCase, Definition, RuleNode } from "../types";
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

/**
 * Adds an Output on an unconnected Default; any other graph is returned as it
 * is. It only adds: an existing return's value changes through the Output's own
 * form, and the update this function also made could overwrite that value
 * with "0" when a repeated click ran its updater again.
 */
export function addSwitchDefaultReturn(
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

/** A case the Switch does not have yet, checked last; the ID is chosen by the caller. */
export function withNewCase(
  cases: readonly BranchCase[],
  id: string,
): BranchCase[] {
  return [
    ...cases,
    { id, label: `Case ${cases.length + 1}`, expression: "true" },
  ];
}

/** The cases with one case's label or expression changed. */
export function withCaseChanged(
  cases: readonly BranchCase[],
  id: string,
  change: Partial<BranchCase>,
): BranchCase[] {
  return cases.map((option) =>
    option.id === id ? { ...option, ...change } : option,
  );
}

/** The cases without one case; patchGraphNode drops its connections. */
export function withoutCase(
  cases: readonly BranchCase[],
  id: string,
): BranchCase[] {
  return cases.filter((option) => option.id !== id);
}

/**
 * The cases with one case moved up (-1) or down (+1), which changes which case
 * matches first; at either end, the same cases.
 */
export function withCaseMoved(
  cases: readonly BranchCase[],
  id: string,
  direction: -1 | 1,
): readonly BranchCase[] {
  const index = cases.findIndex((option) => option.id === id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= cases.length) return cases;
  const moved = [...cases];
  [moved[index], moved[target]] = [moved[target], moved[index]];
  return moved;
}
