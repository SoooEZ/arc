import type { Definition, RuleNode } from "../../types";

/** The node an editor selects first: the first Condition, otherwise the first node. */
export function defaultSelection(definition: Definition): RuleNode {
  return (
    definition.nodes.find((node) => node.type === "CONDITION") ??
    definition.nodes[0]
  );
}

/**
 * The selected node always comes from the current draft. A version load or a
 * code build can remove the requested node; the selection then falls back to
 * the default instead of pointing at a node the canvas cannot show.
 */
export function selectedNode(
  definition: Definition,
  requestedId: string,
): RuleNode {
  return (
    definition.nodes.find((node) => node.id === requestedId) ??
    defaultSelection(definition)
  );
}
