import type { Definition, NodeType, Rule, RuleNode } from "../types";
import { nodeLabel } from "../types";
import { sourcePorts } from "./nodePorts";
export type DefinitionChange = (definition: Definition) => Definition;
export const ruleSnapshot = (rule: Rule) =>
  JSON.stringify([rule.name, rule.description, rule.draft]);
/** Presentation-only dragging must not refetch semantic diagnostics or variables. */
export const semanticGraphKey = (definition: Definition) =>
  JSON.stringify({
    ...definition,
    nodes: definition.nodes.map(({ position: _position, ...node }) => node),
  });
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
export function removeGraphNode(
  definition: Definition,
  id: string,
): Definition {
  if (definition.nodes.find((node) => node.id === id)?.type === "INPUT")
    return definition;
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
  if (
    source === target ||
    !definition.nodes.some((node) => node.id === source) ||
    !definition.nodes.some((node) => node.id === target)
  )
    return definition;
  const sourceNode = definition.nodes.find((node) => node.id === source)!;
  if (
    !sourcePorts(sourceNode).some((port) => port.id === sourceHandle) ||
    definition.nodes.find((node) => node.id === target)?.type === "INPUT"
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
const nodeDefaults: Record<
  NodeType,
  { expression?: string; storesResult?: boolean }
> = {
  INPUT: {},
  FORMULA: { expression: "1 + 1", storesResult: true },
  CONDITION: { expression: "true" },
  SWITCH: {},
  TRANSFORM: { storesResult: true },
  REFERENCE: { storesResult: true },
  OUTPUT: { expression: "0" },
};
export function createGraphNode(
  type: NodeType,
  id: string,
  position: RuleNode["position"],
  index: number,
): RuleNode {
  const defaults = nodeDefaults[type];
  return {
    id,
    type,
    position,
    label: type === "REFERENCE" ? "Reusable rule" : nodeLabel[type],
    expression: defaults.expression,
    output: defaults.storesResult ? `result_${index}` : undefined,
    bindings: type === "REFERENCE" ? {} : undefined,
    cases:
      type === "SWITCH"
        ? [
            { id: "case-1", label: "Case 1", expression: "true" },
            { id: "case-2", label: "Case 2", expression: "false" },
          ]
        : undefined,
    fields:
      type === "TRANSFORM"
        ? [{ name: "value", expression: "null" }]
        : undefined,
  };
}
export interface VariableOption {
  name: string;
  type: string;
  label: string;
}
export function inputVariables(definition: Definition): VariableOption[] {
  return definition.inputs.map((input) => ({
    name: input.name,
    type: input.type,
    label: `Input · ${input.type.toLowerCase()}`,
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
      .map((node) => ({
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
