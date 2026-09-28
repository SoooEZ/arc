import type { Definition, InputType, NodeType, Rule, RuleNode } from "../types";
import { uniqueName } from "./ids";
import { isDecimalNumber, isJsonObject, stringifyJson } from "./json";
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
  if (isDecimalNumber(value)) return value.text;
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
export function withNodePositions(definition: Definition): Definition {
  if (definition.nodes.every((node) => node.position)) return definition;
  return {
    ...definition,
    nodes: definition.nodes.map((node) =>
      node.position ? node : { ...node, position: { x: 0, y: 0 } },
    ),
  };
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
/** The Input node stays, and every draft keeps at least one node, including drafts without an Input. */
export function canRemoveGraphNode(
  definition: Definition,
  id: string,
): boolean {
  const node = definition.nodes.find((candidate) => candidate.id === id);
  return (
    !!node && nodeKinds[node.type].removable && definition.nodes.length > 1
  );
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
function variableNames(definition: Definition): string[] {
  return [
    ...definition.inputs.map((input) => input.name),
    ...definition.nodes.flatMap((node) => (node.output ? [node.output] : [])),
  ];
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
  const grouped = new Map<
    string,
    { option: VariableOption; labels: Set<string> }
  >();
  for (const option of candidates) {
    const entry = grouped.get(option.name);
    if (entry) entry.labels.add(option.label);
    else grouped.set(option.name, { option, labels: new Set([option.label]) });
  }
  return [...grouped.values()].map(({ option, labels }) => ({
    ...option,
    label: [...labels].join(" / "),
  }));
}
