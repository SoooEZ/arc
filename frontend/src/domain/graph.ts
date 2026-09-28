import type {
  Definition,
  Input,
  InputType,
  NodeType,
  Rule,
  RuleNode,
} from "../types";
import { uniqueName } from "./ids";
import {
  decimalKey,
  isDecimalNumber,
  isJsonObject,
  stringifyJson,
} from "./json";
import { nodeKinds } from "./nodeKinds";
import { hasTargetPort, sourcePorts } from "./nodePorts";
export type DefinitionChange = (definition: Definition) => Definition;
export const ruleSnapshot = (
  rule: Pick<Rule, "name" | "description" | "draft">,
) => stringifyJson([rule.name, rule.description, rule.draft]);
/** Presentation-only dragging must not refetch semantic diagnostics or variables. */
export const semanticGraphKey = (definition: Definition) =>
  stringifyJson({
    ...definition,
    nodes: definition.nodes.map(({ position: _position, ...node }) => node),
  });

/**
 * What the server's scope analysis reads (BranchScopes and the graph
 * topology): input names, each node's ID, kind, stored result name and a
 * Switch's case IDs, and every connection. Labels, expressions, defaults and
 * positions are not part of it, so editing them keeps the variables in scope
 * and sends no read (lesson F10 still applies to a pending read).
 */
export function scopeGraphKey(definition: Definition): string {
  const nodes = definition.nodes.map((node) => [
    node.id,
    node.type,
    nodeKinds[node.type].storesResult ? (node.output ?? null) : null,
    node.type === "SWITCH" ? (node.cases ?? []).map((c) => c.id) : null,
  ]);
  const edges = definition.edges.map((edge) => [
    edge.source,
    edge.sourceHandle,
    edge.target,
  ]);
  return JSON.stringify([
    definition.inputs.map((input) => input.name),
    nodes,
    edges,
  ]);
}

/**
 * Compares definitions the way the server stores them: object key order does
 * not matter and an explicit null equals an absent field. A save response
 * lists every record field (unset ones as null) in declaration order, so it
 * differs from the submitted draft only in these respects.
 */
export function sameDefinition(left: Definition, right: Definition): boolean {
  return left === right || canonicalJson(left) === canonicalJson(right);
}
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  // A number is its value and decimal places however it is spelled: the server echoes
  // exponent notation in plain digits, which used to replace the local draft.
  if (isDecimalNumber(value)) return decimalKey(value.text) ?? value.text;
  if (typeof value === "number") {
    const token = JSON.stringify(value);
    return decimalKey(token) ?? token;
  }
  if (!isJsonObject(value)) return JSON.stringify(value) ?? "null";
  const fields: string[] = [];
  for (const key of Object.keys(value).sort())
    if (value[key] != null)
      fields.push(`${JSON.stringify(key)}:${canonicalJson(value[key])}`);
  return `{${fields.join(",")}}`;
}

/**
 * API clients may omit node positions, which the server accepts. The editor
 * places such nodes at the origin once, when a draft enters it, so graph
 * operations and edge routing can rely on every node having a position.
 */
/**
 * Applies a node fragment build to the local draft, taking only what the
 * fragment owns, as the server's replaceNode does: the node, its outgoing
 * edges and, for an Input fragment, the parameters. Unchanged parts keep their
 * local objects (the build echo differs in key order, explicit nulls and edge
 * order), so an unchanged fragment returns `current` itself and the document
 * stays clean with its preview identity (lesson F1, F3).
 */
export function applyNodeFragment(
  current: Definition,
  nodeId: string,
  built: Definition,
): Definition {
  const localNode = current.nodes.find((node) => node.id === nodeId);
  const builtNode = built.nodes.find((node) => node.id === nodeId);
  if (!localNode || !builtNode) return built;
  const node = sameJson(localNode, builtNode) ? localNode : builtNode;
  const nodes =
    node === localNode
      ? current.nodes
      : current.nodes.map((candidate) =>
          candidate.id === nodeId ? node : candidate,
        );
  const edges = withOutgoingEdges(
    current.edges,
    nodeId,
    built.edges.filter((edge) => edge.source === nodeId),
  );
  const inputs =
    localNode.type === "INPUT" && !sameJson(current.inputs, built.inputs)
      ? built.inputs
      : current.inputs;
  if (
    nodes === current.nodes &&
    edges === current.edges &&
    inputs === current.inputs
  )
    return current;
  return { ...current, inputs, nodes, edges };
}

/**
 * The edges with `source`'s outgoing edges replaced by `outgoing`, in place of
 * the first one. The same set in any order keeps the local objects and order;
 * a changed set keeps each unchanged local edge object.
 */
function withOutgoingEdges(
  edges: Definition["edges"],
  source: string,
  outgoing: Definition["edges"],
): Definition["edges"] {
  const local = edges.filter((edge) => edge.source === source);
  const localByJson = new Map(local.map((edge) => [canonicalJson(edge), edge]));
  const unchanged =
    local.length === outgoing.length &&
    outgoing.every((edge) => localByJson.has(canonicalJson(edge)));
  if (unchanged) return edges;
  const replacement = outgoing.map(
    (edge) => localByJson.get(canonicalJson(edge)) ?? edge,
  );
  const result: Definition["edges"] = [];
  let inserted = false;
  for (const edge of edges) {
    if (edge.source !== source) {
      result.push(edge);
      continue;
    }
    if (!inserted) result.push(...replacement);
    inserted = true;
  }
  if (!inserted) result.push(...replacement);
  return result;
}

const sameJson = (left: unknown, right: unknown) =>
  canonicalJson(left) === canonicalJson(right);

/**
 * Every node gets a numeric position when a draft enters the editor: a node
 * without one is placed at the origin, and coordinates that arrived as
 * DecimalNumber become numbers. The server writes its double coordinates as
 * 400.0, which the lossless codec keeps as a DecimalNumber; position
 * arithmetic (placement, focus, routing) needs plain numbers.
 */
export function withNodePositions(definition: Definition): Definition {
  if (definition.nodes.every((node) => hasNumericPosition(node)))
    return definition;
  return {
    ...definition,
    nodes: definition.nodes.map((node) =>
      hasNumericPosition(node)
        ? node
        : { ...node, position: numericPosition(node.position) },
    ),
  };
}

function hasNumericPosition(node: RuleNode): boolean {
  return (
    !!node.position &&
    typeof node.position.x === "number" &&
    typeof node.position.y === "number"
  );
}

function numericPosition(
  position: RuleNode["position"] | null | undefined,
): RuleNode["position"] {
  return { x: coordinate(position?.x), y: coordinate(position?.y) };
}

function coordinate(value: unknown): number {
  if (typeof value === "number") return value;
  if (isDecimalNumber(value)) return Number(value.text);
  return 0;
}

/** The rule version an error location, diagnostic or trace step belongs to. */
export interface GraphLocation {
  ruleId: string | null;
  version: number | null;
}
/**
 * Preview reports its root graph as rule "preview" without a version. A
 * published rule may also have the ID "preview", but its locations always
 * carry a version.
 */
export function isPreviewRoot(location: GraphLocation): boolean {
  return location.ruleId === "preview" && location.version === null;
}
/**
 * Whether a location belongs to the graph an editor shows: static diagnostics
 * name no rule, preview reports its root with the sentinel, and problems
 * carried into a referenced-rule viewer name that rule and version. Any other
 * location, including this rule's own published version called through a
 * Reference, belongs to a referenced graph.
 */
export function isCurrentGraphLocation(
  location: GraphLocation,
  shown: { ruleId: string; version: number | null },
): boolean {
  if (!location.ruleId || isPreviewRoot(location)) return true;
  return location.ruleId === shown.ruleId && location.version === shown.version;
}
export function patchGraphNode(
  definition: Definition,
  id: string,
  patch: Partial<RuleNode>,
): Definition {
  const updated = definition.nodes.find((node) => node.id === id);
  const validHandles =
    updated && patch.cases
      ? new Set(sourcePorts({ ...updated, ...patch }).map((port) => port.id))
      : null;
  return {
    ...definition,
    nodes: definition.nodes.map((node) =>
      node.id === id ? { ...node, ...patch } : node,
    ),
    edges: validHandles
      ? definition.edges.filter(
          (edge) => edge.source !== id || validHandles.has(edge.sourceHandle),
        )
      : definition.edges,
  };
}
/**
 * The graph's entry Input stays: the first Input in document order, as the
 * server's Definition.inputNode reads it. An extra Input can go, since the
 * graph is invalid until it does. Every draft keeps at least one node,
 * including drafts without an Input.
 */
export function canRemoveGraphNode(
  definition: Definition,
  id: string,
): boolean {
  const node = definition.nodes.find((candidate) => candidate.id === id);
  if (!node || definition.nodes.length <= 1) return false;
  const removable = nodeKinds[node.type].removable;
  if (removable === "extra") {
    const first = definition.nodes.find(
      (candidate) => candidate.type === node.type,
    );
    return first?.id !== id;
  }
  return removable;
}
export function removeGraphNode(
  definition: Definition,
  id: string,
): Definition {
  if (!canRemoveGraphNode(definition, id)) return definition;
  return {
    ...definition,
    nodes: definition.nodes.filter((node) => node.id !== id),
    edges: definition.edges.filter(
      (edge) => edge.source !== id && edge.target !== id,
    ),
  };
}
export function connectGraphNodes(
  definition: Definition,
  source: string,
  target: string,
  sourceHandle: string,
  edgeId: string,
): Definition {
  const sourceNode = definition.nodes.find((node) => node.id === source);
  const targetNode = definition.nodes.find((node) => node.id === target);
  if (
    source === target ||
    !sourceNode ||
    !targetNode ||
    !hasTargetPort(targetNode) ||
    !sourcePorts(sourceNode).some((port) => port.id === sourceHandle)
  )
    return definition;
  if (
    definition.edges.some(
      (edge) =>
        edge.source === source &&
        edge.target === target &&
        edge.sourceHandle === sourceHandle,
    )
  )
    return definition;
  return {
    ...definition,
    edges: [...definition.edges, { id: edgeId, source, target, sourceHandle }],
  };
}
/** Names already in use as variables: input parameters and node results. */
export function variableNames(definition: Definition): string[] {
  return [
    ...definition.inputs.map((input) => input.name),
    ...definition.nodes.flatMap((node) => (node.output ? [node.output] : [])),
  ];
}
/**
 * A new required NUMBER parameter named input<N>, unique among inputs and node
 * results (lesson F19): a parameter named like a result made that node fail
 * with "cannot overwrite input".
 */
export function newInputParameter(definition: Definition): Input {
  return {
    name: uniqueName(
      "input",
      variableNames(definition),
      definition.inputs.length + 1,
    ),
    type: "NUMBER",
    required: true,
    defaultValue: null,
  };
}
export function createGraphNode(
  definition: Definition,
  type: NodeType,
  id: string,
  position: RuleNode["position"],
): RuleNode {
  const kind = nodeKinds[type];
  const fields = kind.newNodeFields();
  return {
    id,
    type,
    position,
    label: kind.newNodeLabel,
    expression: fields.expression,
    // A reused name would make two nodes write the same variable.
    output: kind.storesResult
      ? uniqueName("result_", variableNames(definition))
      : undefined,
    bindings: fields.bindings,
    cases: fields.cases,
    fields: fields.fields,
  };
}
export interface VariableOption {
  name: string;
  type: InputType | "RESULT";
  /** Display names of the producing nodes, combined for alternative branches. */
  label: string;
}
export function variableOptionLabel(option: VariableOption): string {
  return `${option.name} [${option.type.toLowerCase()}] from ${option.label}`;
}
export function inputVariables(definition: Definition): VariableOption[] {
  const inputNode = definition.nodes.find((node) => node.type === "INPUT");
  return definition.inputs.map((input) => ({
    name: input.name,
    type: input.type,
    label: inputNode?.label ?? nodeKinds.INPUT.label,
  }));
}
export function availableVariables(
  definition: Definition,
  nodeId: string,
  available: string[] = [],
): VariableOption[] {
  const parents = new Map<string, string[]>();
  for (const edge of definition.edges)
    parents.set(edge.target, [
      ...(parents.get(edge.target) || []),
      edge.source,
    ]);
  const upstream = new Set<string>();
  const pending = [...(parents.get(nodeId) || [])];
  while (pending.length) {
    const id = pending.pop()!;
    if (id === nodeId || upstream.has(id)) continue;
    upstream.add(id);
    pending.push(...(parents.get(id) || []));
  }
  const candidates = [
    ...inputVariables(definition).filter((input) =>
      available.includes(input.name),
    ),
    ...definition.nodes
      .filter(
        (node) =>
          node.output &&
          upstream.has(node.id) &&
          available.includes(node.output),
      )
      .map((node): VariableOption => ({
        name: node.output!,
        type: "RESULT",
        label: node.label,
      })),
  ];
  return groupVariablesByName(candidates);
}

/**
 * One option per variable name: the first option's type, with the labels of
 * every producer joined by " / ", so a name two branches assign lists once.
 */
export function groupVariablesByName(
  options: VariableOption[],
): VariableOption[] {
  const grouped = new Map<
    string,
    { option: VariableOption; labels: Set<string> }
  >();
  for (const option of options) {
    const entry = grouped.get(option.name);
    if (entry) entry.labels.add(option.label);
    else grouped.set(option.name, { option, labels: new Set([option.label]) });
  }
  return [...grouped.values()].map(({ option, labels }) => ({
    ...option,
    label: [...labels].join(" / "),
  }));
}

/** Every variable a definition declares, whatever the node: its inputs and node results. */
export function declaredVariables(definition: Definition): VariableOption[] {
  const results: VariableOption[] = [];
  for (const node of definition.nodes)
    if (node.output)
      results.push({ name: node.output, type: "RESULT", label: node.label });
  return groupVariablesByName([...inputVariables(definition), ...results]);
}
