import type { Definition, RuleNode } from "../types";
import { sameDefinition, sameJson } from "./definitionEchoes";
import { listed } from "./text";

/**
 * What a draft changes against the published version it would follow, named
 * the way the editor shows the graph: nodes by label, inputs by name.
 */
export interface VersionChanges {
  /** The draft is that version, positions included: publishing would repeat it. */
  identical: boolean;
  addedNodes: string[];
  removedNodes: string[];
  changedNodes: string[];
  /** Cards that only moved. */
  movedNodes: number;
  addedConnections: number;
  removedConnections: number;
  addedInputs: string[];
  removedInputs: string[];
  changedInputs: string[];
  /** The rule's notes, its comments in code, differ. */
  notesChanged: boolean;
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
    changedInputs: [],
    notesChanged: !sameJson(published.notes ?? [], draft.notes ?? []),
  };
  const before = new Map(published.nodes.map((node) => [node.id, node]));
  const after = new Map(draft.nodes.map((node) => [node.id, node]));
  for (const node of draft.nodes) {
    const earlier = before.get(node.id);
    if (!earlier) changes.addedNodes.push(node.label);
    else if (!sameJson(withoutPosition(earlier), withoutPosition(node)))
      changes.changedNodes.push(node.label);
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
  const inputsBefore = new Map(
    published.inputs.map((input) => [input.name, input]),
  );
  const inputNames = new Set(draft.inputs.map((input) => input.name));
  for (const input of draft.inputs) {
    const earlier = inputsBefore.get(input.name);
    if (!earlier) changes.addedInputs.push(input.name);
    else if (!sameJson(earlier, input)) changes.changedInputs.push(input.name);
  }
  for (const input of published.inputs)
    if (!inputNames.has(input.name)) changes.removedInputs.push(input.name);
  return changes;
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

function named(names: string[]): string {
  if (names.length <= namesShown) return listed(names);
  return `${names.slice(0, namesShown).join(", ")} and ${names.length - namesShown} more`;
}

function counted(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** The changes as the lines the publish dialog lists, most significant first. */
export function changeLines(changes: VersionChanges): string[] {
  const lines: string[] = [];
  if (changes.addedNodes.length)
    lines.push(`Added: ${named(changes.addedNodes)}`);
  if (changes.removedNodes.length)
    lines.push(`Removed: ${named(changes.removedNodes)}`);
  if (changes.changedNodes.length)
    lines.push(`Changed: ${named(changes.changedNodes)}`);
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
  if (connections.length) lines.push(connections.join(", "));
  if (changes.addedInputs.length)
    lines.push(`New inputs: ${named(changes.addedInputs)}`);
  if (changes.removedInputs.length)
    lines.push(`Removed inputs: ${named(changes.removedInputs)}`);
  if (changes.changedInputs.length)
    lines.push(`Changed inputs: ${named(changes.changedInputs)}`);
  if (changes.notesChanged) lines.push("Notes changed");
  if (changes.movedNodes)
    lines.push(`Moved ${counted(changes.movedNodes, "card", "cards")}`);
  return lines;
}
