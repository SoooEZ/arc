import type { Definition, Input, RuleNode } from "../types";
import { renameVariable } from "./expressionSymbols";
import { isIdentifier } from "./identifiers";
import { storesResult } from "./nodeKinds";

/** What declares a variable: an input parameter, by position, or a node's result. */
export type VariableDeclaration = { input: number } | { node: string };

/** How many declarations other than `declaration` name the variable `name`. */
function otherDeclarations(
  definition: Definition,
  declaration: VariableDeclaration,
  name: string,
): number {
  let count = 0;
  definition.inputs.forEach((input, index) => {
    if (
      input.name === name &&
      !("input" in declaration && declaration.input === index)
    )
      count++;
  });
  for (const node of definition.nodes)
    if (
      storesResult(node.type) &&
      node.output === name &&
      !("node" in declaration && declaration.node === node.id)
    )
      count++;
  return count;
}

/**
 * Whether renaming `declaration` from `from` to `to` may rewrite the
 * expressions that read `from`: both are complete names, and no other
 * declaration names either, so every read of `from` is a read of this one and
 * the rewrite cannot merge two variables.
 */
export function canRenameReferences(
  definition: Definition,
  declaration: VariableDeclaration,
  from: string,
  to: string,
): boolean {
  return (
    from !== to &&
    isIdentifier(from) &&
    isIdentifier(to) &&
    otherDeclarations(definition, declaration, from) === 0 &&
    otherDeclarations(definition, declaration, to) === 0
  );
}

function renamedValues(
  values: Record<string, string>,
  from: string,
  to: string,
): Record<string, string> {
  let changed = false;
  const renamed: Record<string, string> = {};
  for (const [key, expression] of Object.entries(values)) {
    renamed[key] = renameVariable(expression, from, to);
    changed ||= renamed[key] !== expression;
  }
  return changed ? renamed : values;
}

function renamedNode(node: RuleNode, from: string, to: string): RuleNode {
  const rename = (text: string) => renameVariable(text, from, to);
  const patch: Partial<RuleNode> = {};
  if (node.expression != null && rename(node.expression) !== node.expression)
    patch.expression = rename(node.expression);
  if (node.selector != null && rename(node.selector) !== node.selector)
    patch.selector = rename(node.selector);
  if (node.cases?.some((item) => rename(item.expression) !== item.expression))
    patch.cases = node.cases.map((item) => ({
      ...item,
      expression: rename(item.expression),
    }));
  if (
    node.fields?.some((field) => rename(field.expression) !== field.expression)
  )
    patch.fields = node.fields.map((field) => ({
      ...field,
      expression: rename(field.expression),
    }));
  if (node.bindings) {
    const bindings = renamedValues(node.bindings, from, to);
    if (bindings !== node.bindings) patch.bindings = bindings;
  }
  return Object.keys(patch).length ? { ...node, ...patch } : node;
}

function renamedInput(input: Input, from: string, to: string): Input {
  if (!input.source) return input;
  const bindings = renamedValues(input.source.bindings, from, to);
  return bindings === input.source.bindings
    ? input
    : { ...input, source: { ...input.source, bindings } };
}

/**
 * The definition with every expression that reads the variable `from`
 * reading `to`: node expressions, selectors, cases, Transform fields,
 * Reference bindings and the mappings of sourced inputs. Declarations keep
 * their names, and unchanged nodes and inputs keep their objects.
 */
export function withRenamedReferences(
  definition: Definition,
  from: string,
  to: string,
): Definition {
  const nodes = definition.nodes.map((node) => renamedNode(node, from, to));
  const inputs = definition.inputs.map((input) =>
    renamedInput(input, from, to),
  );
  const nodesChanged = nodes.some(
    (node, index) => node !== definition.nodes[index],
  );
  const inputsChanged = inputs.some(
    (input, index) => input !== definition.inputs[index],
  );
  if (!nodesChanged && !inputsChanged) return definition;
  return {
    ...definition,
    nodes: nodesChanged ? nodes : definition.nodes,
    inputs: inputsChanged ? inputs : definition.inputs,
  };
}
