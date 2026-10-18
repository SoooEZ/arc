import type { BranchCase, Definition, RuleEdge, RuleNode } from "../types";
import { patchGraphNode } from "./graph";
import { canAddEdge, canAddNode, MAX_LABEL_CHARACTERS } from "./limits";
import { caseHandle, handles, nodeWidth } from "./nodePorts";

/**
 * How the editor's one Condition node branches. The stored kind follows from
 * it: True / False is a CONDITION; cases, checked as conditions or matched
 * against a value, are a SWITCH. Graphs, published versions and ARC Script
 * keep both kinds unchanged.
 */
export type BranchMode = "true-false" | "conditions" | "value";

export function branchMode(node: RuleNode): BranchMode {
  if (node.type === "CONDITION") return "true-false";
  return node.selector != null ? "value" : "conditions";
}

/**
 * Whether the node can branch True / False: a CONDITION, or cases that hold
 * exactly one condition, whose case and Default become True and False.
 */
export function canBranchTrueFalse(node: RuleNode): boolean {
  if (node.type === "CONDITION") return true;
  return (
    node.type === "SWITCH" &&
    node.selector == null &&
    (node.cases?.length ?? 0) === 1
  );
}

/** The nodes with the one that has `replacement`'s ID replaced. */
function withNodeReplaced(
  nodes: RuleNode[],
  replacement: RuleNode,
): RuleNode[] {
  return nodes.map((node) => (node.id === replacement.id ? replacement : node));
}

/** The node's outgoing connections with their handles renamed; the others as they are. */
function withHandlesRenamed(
  edges: RuleEdge[],
  nodeId: string,
  renamed: ReadonlyMap<string, string>,
): RuleEdge[] {
  return edges.map((edge) => {
    const handle = edge.source === nodeId && renamed.get(edge.sourceHandle);
    return handle ? { ...edge, sourceHandle: handle } : edge;
  });
}

/**
 * The draft with a Condition node switched to `mode`, keeping its
 * connections. From True / False, the condition becomes the first case
 * (`caseId`, chosen by the caller) and True and False move to that case and
 * Default; matching a value keeps the condition as the value to match and takes
 * the case when it is true, so the node routes as before. Back to True / False
 * (one condition case, see canBranchTrueFalse) reverses that. Between the two
 * case modes only the selector changes, as the case form always did. Any other
 * request, or a node that is not a Condition, returns the draft itself.
 */
export function withBranchMode(
  definition: Definition,
  nodeId: string,
  mode: BranchMode,
  caseId: string,
): Definition {
  const node = definition.nodes.find((item) => item.id === nodeId);
  if (!node || (node.type !== "CONDITION" && node.type !== "SWITCH"))
    return definition;
  const current = branchMode(node);
  if (mode === current) return definition;
  if (current === "true-false") {
    const condition = node.expression ?? "";
    const matchValue = mode === "value";
    const cases: RuleNode = {
      ...node,
      type: "SWITCH",
      expression: undefined,
      selector: matchValue ? condition : null,
      cases: [
        {
          id: caseId,
          label: "Case 1",
          expression: matchValue ? "true" : condition,
        },
      ],
    };
    return {
      ...definition,
      nodes: withNodeReplaced(definition.nodes, cases),
      edges: withHandlesRenamed(
        definition.edges,
        nodeId,
        new Map([
          [handles.true, caseHandle(caseId)],
          [handles.false, handles.default],
        ]),
      ),
    };
  }
  if (mode === "true-false") {
    if (!canBranchTrueFalse(node)) return definition;
    const [only] = node.cases ?? [];
    const trueFalse: RuleNode = {
      ...node,
      type: "CONDITION",
      expression: only.expression,
      selector: undefined,
      cases: undefined,
    };
    return {
      ...definition,
      nodes: withNodeReplaced(definition.nodes, trueFalse),
      edges: withHandlesRenamed(
        definition.edges,
        nodeId,
        new Map([
          [caseHandle(only.id), handles.true],
          [handles.default, handles.false],
        ]),
      ),
    };
  }
  return patchGraphNode(definition, nodeId, {
    selector: mode === "value" ? "true" : null,
  });
}

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
