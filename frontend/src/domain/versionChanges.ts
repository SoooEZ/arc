import type { Definition, Input, NodeType, RuleNode } from "../types";
import { sameDefinition, sameJson } from "./definitionEchoes";
import { inputTypeFacts } from "./inputTypes";
import { stringifyJson } from "./json";
import { nodeKinds } from "./nodeKinds";
import { listed } from "./text";

/** One property that differs: its value in the version and in the draft, null when unset. */
export interface FieldChange {
  field: string;
  before: string | null;
  after: string | null;
}

/** A node or input present in both, by its name in the draft, and what differs in it. */
export interface ItemChange {
  name: string;
  fields: FieldChange[];
}

/**
 * What a draft changes against the published version it would follow, named
 * the way the editor shows the graph: nodes by label, inputs by name.
 */
export interface VersionChanges {
  /** The draft is that version, positions included: publishing would repeat it. */
  identical: boolean;
  addedNodes: string[];
  removedNodes: string[];
  changedNodes: ItemChange[];
  /** Cards that only moved. */
  movedNodes: number;
  addedConnections: number;
  removedConnections: number;
  addedInputs: string[];
  removedInputs: string[];
  /** An input in the same place under another name, of the same type. */
  renamedInputs: { from: string; to: string }[];
  changedInputs: ItemChange[];
  /** The rule's notes, its comments in code, differ. */
  notesChanged: boolean;
}

/** What a node's expression is to its kind. */
const expressionField: Record<NodeType, string> = {
  INPUT: "Expression",
  FORMULA: "Formula",
  CONDITION: "Condition",
  SWITCH: "Expression",
  TRANSFORM: "Expression",
  REFERENCE: "Expression",
  OUTPUT: "Returns",
};

function kindName(node: RuleNode): string {
  return node.type === "SWITCH"
    ? "Condition with cases"
    : nodeKinds[node.type].label;
}

function rulePin(node: RuleNode): string | null {
  if (!node.ruleId) return null;
  return node.version ? `${node.ruleId} v${node.version}` : node.ruleId;
}

/** Adds a change when the two values differ. */
function compare(
  fields: FieldChange[],
  field: string,
  before: string | null | undefined,
  after: string | null | undefined,
) {
  if ((before ?? null) !== (after ?? null))
    fields.push({ field, before: before ?? null, after: after ?? null });
}

/** Keyed entries (cases by ID, fields and bindings by name), compared one by one. */
function compareEntries(
  fields: FieldChange[],
  before: Map<string, { name: string; value: string }>,
  after: Map<string, { name: string; value: string }>,
) {
  for (const [key, entry] of after)
    compare(fields, entry.name, before.get(key)?.value, entry.value);
  for (const [key, entry] of before)
    if (!after.has(key)) compare(fields, entry.name, entry.value, null);
}

function nodeFields(before: RuleNode, after: RuleNode): FieldChange[] {
  const fields: FieldChange[] = [];
  compare(fields, "Name", before.label, after.label);
  compare(fields, "Kind", kindName(before), kindName(after));
  // A Condition that became one with cases loses its expression: name it as it was.
  compare(
    fields,
    expressionField[after.expression == null ? before.type : after.type],
    before.expression,
    after.expression,
  );
  compare(fields, "Matches", before.selector, after.selector);
  const cases = (node: RuleNode) =>
    new Map(
      (node.cases ?? []).map((item) => [
        item.id,
        { name: `Case ${item.label}`, value: item.expression },
      ]),
    );
  compareEntries(fields, cases(before), cases(after));
  const order = (node: RuleNode) =>
    (node.cases ?? []).map((item) => item.label).join(", ");
  if (
    fields.every((change) => !change.field.startsWith("Case ")) &&
    order(before) !== order(after)
  )
    compare(fields, "Case order", order(before), order(after));
  const mapped = (node: RuleNode) =>
    new Map(
      (node.fields ?? []).map((field) => [
        field.name,
        { name: `Field ${field.name}`, value: field.expression },
      ]),
    );
  compareEntries(fields, mapped(before), mapped(after));
  compare(fields, "Rule", rulePin(before), rulePin(after));
  const bindings = (node: RuleNode) =>
    new Map(
      Object.entries(node.bindings ?? {}).map(([name, expression]) => [
        name,
        { name: `Input ${name}`, value: expression },
      ]),
    );
  compareEntries(fields, bindings(before), bindings(after));
  compare(fields, "Result variable", before.output, after.output);
  compare(fields, "Output name", before.outputName, after.outputName);
  return fields;
}

function sourceText(input: Input): string | null {
  const source = input.source;
  if (!source) return null;
  const parts = [`${source.id} v${source.version}`];
  for (const [name, expression] of Object.entries(source.bindings))
    parts.push(`${name} = ${expression}`);
  if (source.pointer) parts.push(source.pointer);
  if (source.onError === "DEFAULT") parts.push("default on error");
  return parts.join(" · ");
}

function inputFields(before: Input, after: Input): FieldChange[] {
  const fields: FieldChange[] = [];
  compare(
    fields,
    "Type",
    inputTypeFacts[before.type].label,
    inputTypeFacts[after.type].label,
  );
  const required = (input: Input) => (input.required ? "yes" : "no");
  compare(fields, "Required", required(before), required(after));
  const fallback = (input: Input) =>
    input.defaultValue == null ? null : stringifyJson(input.defaultValue);
  compare(fields, "Default", fallback(before), fallback(after));
  compare(fields, "Data source", sourceText(before), sourceText(after));
  return fields;
}

/**
 * Compares the draft with the published version node by node and input by
 * input. Both are read as the server stores them (key order, explicit nulls
 * and number spelling do not count), and a connection is its ends and exit.
 */
export function versionChanges(
  published: Definition,
  draft: Definition,
): VersionChanges {
  const changes: VersionChanges = {
    identical: sameDefinition(published, draft),
    addedNodes: [],
    removedNodes: [],
    changedNodes: [],
    movedNodes: 0,
    addedConnections: 0,
    removedConnections: 0,
    addedInputs: [],
    removedInputs: [],
    renamedInputs: [],
    changedInputs: [],
    notesChanged: !sameJson(published.notes ?? [], draft.notes ?? []),
  };
  const before = new Map(published.nodes.map((node) => [node.id, node]));
  const after = new Map(draft.nodes.map((node) => [node.id, node]));
  for (const node of draft.nodes) {
    const earlier = before.get(node.id);
    if (!earlier) changes.addedNodes.push(node.label);
    else if (!sameJson(withoutPosition(earlier), withoutPosition(node)))
      changes.changedNodes.push({
        name: node.label,
        fields: nodeFields(earlier, node),
      });
    else if (!sameJson(earlier.position, node.position)) changes.movedNodes++;
  }
  for (const node of published.nodes)
    if (!after.has(node.id)) changes.removedNodes.push(node.label);
  const connected = new Set(draft.edges.map(connection));
  const wasConnected = new Set(published.edges.map(connection));
  changes.addedConnections = [...connected].filter(
    (key) => !wasConnected.has(key),
  ).length;
  changes.removedConnections = [...wasConnected].filter(
    (key) => !connected.has(key),
  ).length;
  compareInputs(published.inputs, draft.inputs, changes);
  return changes;
}

/**
 * Inputs pair by name. An input in the same place that differs only in its
 * name, whose old name the draft and new name the version lack, was renamed
 * rather than replaced.
 */
function compareInputs(
  published: Input[],
  draft: Input[],
  changes: VersionChanges,
) {
  const names = new Set(draft.map((input) => input.name));
  const wereNamed = new Set(published.map((input) => input.name));
  const renamedFrom = new Map<string, Input>();
  published.forEach((earlier, index) => {
    const later = draft[index];
    if (
      later &&
      !names.has(earlier.name) &&
      !wereNamed.has(later.name) &&
      sameJson({ ...earlier, name: "" }, { ...later, name: "" })
    ) {
      renamedFrom.set(later.name, earlier);
      changes.renamedInputs.push({ from: earlier.name, to: later.name });
    }
  });
  const byName = new Map(published.map((input) => [input.name, input]));
  for (const input of draft) {
    const earlier = renamedFrom.get(input.name) ?? byName.get(input.name);
    if (!earlier) changes.addedInputs.push(input.name);
    else {
      const fields = inputFields(earlier, input);
      if (fields.length)
        changes.changedInputs.push({ name: input.name, fields });
    }
  }
  const renamed = new Set(changes.renamedInputs.map((pair) => pair.from));
  for (const input of published)
    if (!names.has(input.name) && !renamed.has(input.name))
      changes.removedInputs.push(input.name);
}

/** A node apart from where its card is drawn. */
function withoutPosition({ position, ...rest }: RuleNode) {
  return rest;
}

/** A connection by its ends and exit; its ID is the draft's own. */
function connection(edge: Definition["edges"][number]): string {
  return `${edge.source}\n${edge.sourceHandle}\n${edge.target}`;
}

/** At most this many names show in one line; the rest are counted. */
const namesShown = 5;
/** At most this many changed nodes or inputs show their changes; the rest are named. */
const detailsShown = 8;

function named(names: string[]): string {
  if (names.length <= namesShown) return listed(names);
  return `${names.slice(0, namesShown).join(", ")} and ${names.length - namesShown} more`;
}

function counted(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** One line of the publish dialog's list, with the property changes it sums up. */
export interface ChangeLine {
  text: string;
  details: FieldChange[];
}

function detailed(
  lines: ChangeLine[],
  items: ItemChange[],
  heading: (name: string) => string,
  rest: (names: string) => string,
) {
  for (const item of items.slice(0, detailsShown))
    lines.push({ text: heading(item.name), details: item.fields });
  if (items.length > detailsShown)
    lines.push({
      text: rest(named(items.slice(detailsShown).map((item) => item.name))),
      details: [],
    });
}

/** The changes as the lines the publish dialog lists, most significant first. */
export function changeLines(changes: VersionChanges): ChangeLine[] {
  const lines: ChangeLine[] = [];
  const line = (text: string) => lines.push({ text, details: [] });
  if (changes.addedNodes.length) line(`Added: ${named(changes.addedNodes)}`);
  if (changes.removedNodes.length)
    line(`Removed: ${named(changes.removedNodes)}`);
  detailed(
    lines,
    changes.changedNodes,
    (name) => `Changed: ${name}`,
    (names) => `Also changed: ${names}`,
  );
  const connections = [
    changes.addedConnections &&
      counted(
        changes.addedConnections,
        "connection added",
        "connections added",
      ),
    changes.removedConnections &&
      counted(
        changes.removedConnections,
        "connection removed",
        "connections removed",
      ),
  ].filter(Boolean);
  if (connections.length) line(connections.join(", "));
  for (const { from, to } of changes.renamedInputs)
    line(`Renamed input: ${from} → ${to}`);
  if (changes.addedInputs.length)
    line(`New inputs: ${named(changes.addedInputs)}`);
  if (changes.removedInputs.length)
    line(`Removed inputs: ${named(changes.removedInputs)}`);
  detailed(
    lines,
    changes.changedInputs,
    (name) => `Changed input: ${name}`,
    (names) => `Also changed inputs: ${names}`,
  );
  if (changes.notesChanged) line("Notes changed");
  if (changes.movedNodes)
    line(`Moved ${counted(changes.movedNodes, "card", "cards")}`);
  return lines;
}
