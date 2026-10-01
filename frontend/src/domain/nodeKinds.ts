import type {
  BranchCase,
  Definition,
  NodeType,
  RuleNode,
  TransformField,
} from "../types";

/**
 * Outgoing connection handles of a node kind. `domain/nodePorts` turns them
 * into the handles that the canvas, layout and graph mutations share.
 */
export type NodeExits =
  /** One `next` handle. */
  | "next"
  /** The `true` and `false` branches. */
  | "true-false"
  /** One `case:<id>` handle per case, in priority order, then `default`. */
  | "cases"
  /** A path ends here. */
  | "none";

/**
 * An optional node property beyond id, type, label and position. `rule` is a
 * Reference's pinned rule: its `ruleId` and `version`.
 */
export type NodeProperty =
  | "expression"
  | "output"
  | "rule"
  | "bindings"
  | "selector"
  | "cases"
  | "fields"
  | "outputName";

/** Kind-specific fields of a newly added node. */
export interface NewNodeFields {
  expression?: string;
  bindings?: Record<string, string>;
  cases?: BranchCase[];
  fields?: TransformField[];
}

/**
 * What the editor knows about one node kind. Every entry sets every field, so
 * adding a NodeType or a fact fails to compile until each kind states it.
 * Icons (components/Icons) and inspector forms (inspector/Inspector) are React
 * components and keep their own Record<NodeType, …> tables beside the UI.
 */
export interface NodeKind {
  /** Name of the kind in the Add node menu, on cards, in the inspector and in previews. */
  label: string;
  /** Label of a newly added node. */
  newNodeLabel: string;
  /**
   * Key of the kind's style classes: cards `node-<key>`, icons
   * `node-icon <key>` and library previews `preview-node-<key>`.
   */
  className: string;
  /** Assigns the scoped variable named by `output`. */
  storesResult: boolean;
  /** Offered by the Add node menu. */
  addable: boolean;
  /**
   * The user may delete it: every node of the kind, or with "extra" only a node
   * after the draft's first of the kind (a draft still keeps at least one node).
   */
  removable: boolean | "extra";
  /** Other nodes may connect into it. */
  acceptsIncoming: boolean;
  exits: NodeExits;
  /**
   * The optional properties its nodes may set, as on the server
   * (`NodeKind.properties()`), which rejects a node that sets any other.
   */
  properties: readonly NodeProperty[];
  /**
   * Fill of the kind's nodes on the canvas minimap. Every other kind color is
   * in the stylesheets, selected through `className`.
   */
  minimapColor: string;
  newNodeFields: () => NewNodeFields;
  /** The one-line detail a canvas card shows under its label. */
  summary: (node: RuleNode, inputCount: number) => string;
}

const neutralMinimap = "#d4dfd8";

function expressionSummary(node: RuleNode): string {
  return node.expression || "Add an expression";
}

function switchSummary(node: RuleNode): string {
  const cases = node.cases?.length ?? 0;
  if (node.selector != null)
    return `Match ${node.selector} · ${cases} cases + default`;
  return `${cases} cases · first match + default`;
}

/** Every node kind, in the order the Add node menu lists them. */
export const nodeKinds: Record<NodeType, NodeKind> = {
  INPUT: {
    label: "Input",
    newNodeLabel: "Input",
    className: "input",
    storesResult: false,
    // The graph's single entry: it comes with the rule and nothing connects
    // into it. The first Input stays; an extra one, which validation rejects
    // ("exactly one Input node"), can be deleted.
    addable: false,
    removable: "extra",
    acceptsIncoming: false,
    exits: "next",
    properties: [],
    minimapColor: neutralMinimap,
    newNodeFields: () => ({}),
    summary: (_node, inputCount) =>
      `${inputCount} input parameter${inputCount === 1 ? "" : "s"}`,
  },
  FORMULA: {
    label: "Formula",
    newNodeLabel: "Formula",
    className: "formula",
    storesResult: true,
    addable: true,
    removable: true,
    acceptsIncoming: true,
    exits: "next",
    properties: ["expression", "output"],
    minimapColor: neutralMinimap,
    newNodeFields: () => ({ expression: "1 + 1" }),
    summary: expressionSummary,
  },
  CONDITION: {
    label: "Condition",
    newNodeLabel: "Condition",
    className: "condition",
    storesResult: false,
    addable: true,
    removable: true,
    acceptsIncoming: true,
    exits: "true-false",
    properties: ["expression"],
    minimapColor: "#e8d8b2",
    newNodeFields: () => ({ expression: "true" }),
    summary: expressionSummary,
  },
  SWITCH: {
    label: "Switch",
    newNodeLabel: "Switch",
    className: "switch",
    storesResult: false,
    addable: true,
    removable: true,
    acceptsIncoming: true,
    exits: "cases",
    properties: ["selector", "cases"],
    minimapColor: neutralMinimap,
    newNodeFields: () => ({
      cases: [
        { id: "case-1", label: "Case 1", expression: "true" },
        { id: "case-2", label: "Case 2", expression: "false" },
      ],
    }),
    summary: switchSummary,
  },
  TRANSFORM: {
    label: "Transform",
    newNodeLabel: "Transform",
    className: "transform",
    storesResult: true,
    addable: true,
    removable: true,
    acceptsIncoming: true,
    exits: "next",
    properties: ["fields", "expression", "output"],
    minimapColor: neutralMinimap,
    newNodeFields: () => ({ fields: [{ name: "value", expression: "null" }] }),
    summary: (node) =>
      node.fields?.length
        ? `${node.fields.length} fields → ${node.output || "data"}`
        : expressionSummary(node),
  },
  REFERENCE: {
    label: "Reuse rule",
    newNodeLabel: "Reusable rule",
    className: "reference",
    storesResult: true,
    addable: true,
    removable: true,
    acceptsIncoming: true,
    exits: "next",
    properties: ["rule", "bindings", "output"],
    minimapColor: neutralMinimap,
    newNodeFields: () => ({ bindings: {} }),
    summary: (node) =>
      `${node.ruleId || "Select a rule"}${node.version ? ` · v${node.version}` : ""}`,
  },
  OUTPUT: {
    label: "Output",
    newNodeLabel: "Output",
    className: "output",
    storesResult: false,
    addable: true,
    removable: true,
    acceptsIncoming: true,
    exits: "none",
    properties: ["expression", "outputName"],
    minimapColor: neutralMinimap,
    newNodeFields: () => ({ expression: "0" }),
    summary: (node) =>
      node.outputName
        ? `${node.outputName} ← ${node.expression || "Choose a value"}`
        : expressionSummary(node),
  },
};

/** Whether `value` names a node kind, e.g. a type read from ARC Script text. */
export function isNodeType(value: string): value is NodeType {
  return Object.hasOwn(nodeKinds, value);
}

/** Every node kind, in the order of the descriptor table. */
export const nodeTypes: readonly NodeType[] =
  Object.keys(nodeKinds).filter(isNodeType);

/** The kinds the Add node menu offers, in menu order. */
export const addableNodeTypes: readonly NodeType[] = nodeTypes.filter(
  (type) => nodeKinds[type].addable,
);

/**
 * The graph's entry Input: the first INPUT in document order, as the server's
 * Definition.inputNode() reads it. Parameters, defaults and the scope's input
 * labels belong to it.
 */
export function entryInputNode(
  definition: Pick<Definition, "nodes">,
): RuleNode | undefined {
  return definition.nodes.find((node) => node.type === "INPUT");
}

/** Formula, Transform and Reference nodes assign the scoped variable named by `output`. */
export function storesResult(type: NodeType): boolean {
  return nodeKinds[type].storesResult;
}

/** The RuleNode keys behind each property. */
const propertyKeys: Record<
  NodeProperty,
  readonly Exclude<keyof RuleNode, "id" | "type" | "label" | "position">[]
> = {
  expression: ["expression"],
  output: ["output"],
  rule: ["ruleId", "version"],
  bindings: ["bindings"],
  selector: ["selector"],
  cases: ["cases"],
  fields: ["fields"],
  outputName: ["outputName"],
};

function isNodeProperty(value: string): value is NodeProperty {
  return Object.hasOwn(propertyKeys, value);
}

const nodeProperties: readonly NodeProperty[] =
  Object.keys(propertyKeys).filter(isNodeProperty);

/** How messages name a property, e.g. "parameter bindings". */
export const propertyNames: Record<NodeProperty, string> = {
  expression: "an expression",
  output: "a result variable",
  rule: "a rule reference",
  bindings: "parameter bindings",
  selector: "a selector",
  cases: "cases",
  fields: "fields",
  outputName: "an output name",
};

/**
 * The properties a node sets although its kind does not use them. The server
 * rejects such a node wherever it appears, published versions included.
 */
export function unusedProperties(node: RuleNode): NodeProperty[] {
  const used = nodeKinds[node.type].properties;
  return nodeProperties.filter(
    (property) =>
      !used.includes(property) &&
      propertyKeys[property].some((key) => node[key] != null),
  );
}

/** A node patch that clears every property the node's kind does not use. */
export function clearUnusedProperties(node: RuleNode): Partial<RuleNode> {
  const patch: Partial<RuleNode> = {};
  for (const property of unusedProperties(node))
    for (const key of propertyKeys[property]) patch[key] = undefined;
  return patch;
}
