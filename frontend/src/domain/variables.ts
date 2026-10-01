import type { Definition, InputType } from "../types";
import { entryInputNode, nodeKinds } from "./nodeKinds";

/** A variable an expression may read: an input parameter or a node result. */
export interface VariableOption {
  name: string;
  type: InputType | "RESULT";
  /** Display names of the producing nodes, combined for alternative branches. */
  label: string;
}

export function variableOptionLabel(option: VariableOption): string {
  return `${option.name} [${option.type.toLowerCase()}] from ${option.label}`;
}

/** Names already in use as variables: input parameters and node results. */
export function variableNames(definition: Definition): string[] {
  return [
    ...definition.inputs.map((input) => input.name),
    ...definition.nodes.flatMap((node) => (node.output ? [node.output] : [])),
  ];
}

export function inputVariables(definition: Definition): VariableOption[] {
  const inputNode = entryInputNode(definition);
  return definition.inputs.map((input) => ({
    name: input.name,
    type: input.type,
    label: inputNode?.label ?? nodeKinds.INPUT.label,
  }));
}

/**
 * The variables `nodeId` may read, in the order they are declared: the inputs
 * and the results of upstream nodes, limited to the names the server's scope
 * analysis lists as `available`.
 */
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
function groupVariablesByName(options: VariableOption[]): VariableOption[] {
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
