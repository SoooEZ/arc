import type { DecisionTable, Definition, Input, RuleNode } from "../types";
import { renameVariable, variablesRead } from "./expressionSymbols";
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

/** A decision table whose condition expressions and result cells read `to` instead of `from`. */
function renamedTable(
  table: DecisionTable,
  rename: (text: string) => string,
): DecisionTable {
  const conditions = table.conditions.map((condition) => {
    const expression = rename(condition.expression);
    return expression === condition.expression
      ? condition
      : { ...condition, expression };
  });
  const rows = table.rows.map((row) => {
    const then = row.then.map(rename);
    return then.every((cell, index) => cell === row.then[index])
      ? row
      : { ...row, then };
  });
  const conditionsChanged = conditions.some(
    (condition, index) => condition !== table.conditions[index],
  );
  const rowsChanged = rows.some((row, index) => row !== table.rows[index]);
  if (!conditionsChanged && !rowsChanged) return table;
  return {
    ...table,
    conditions: conditionsChanged ? conditions : table.conditions,
    rows: rowsChanged ? rows : table.rows,
  };
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
  if (node.table) {
    const table = renamedTable(node.table, rename);
    if (table !== node.table) patch.table = table;
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
 * Reference bindings, decision table conditions and result cells, and the
 * mappings of sourced inputs. Declarations keep their names, and unchanged
 * nodes and inputs keep their objects. Test cells hold literals only.
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

/**
 * Every variable an expression of the definition reads, in the places
 * withRenamedReferences rewrites: node expressions, selectors, cases,
 * Transform fields, Reference bindings, decision table conditions and result
 * cells, and the mappings of sourced inputs.
 */
export function readVariables(definition: Definition): Set<string> {
  const read = new Set<string>();
  const scan = (expression: string | null | undefined) => {
    if (expression)
      for (const name of variablesRead(expression)) read.add(name);
  };
  for (const node of definition.nodes) {
    scan(node.expression);
    scan(node.selector);
    node.cases?.forEach((item) => scan(item.expression));
    node.fields?.forEach((field) => scan(field.expression));
    if (node.bindings) Object.values(node.bindings).forEach(scan);
    node.table?.conditions.forEach((condition) => scan(condition.expression));
    node.table?.rows.forEach((row) => row.then.forEach(scan));
  }
  for (const input of definition.inputs)
    if (input.source) Object.values(input.source.bindings).forEach(scan);
  return read;
}
