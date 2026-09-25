import type { Definition, RuleNode } from "../../types";
import { sourcePorts } from "../../domain/nodePorts";

const nodeFields = ({ position: _position, ...fields }: RuleNode) => fields;
const sameValue = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right);

function mergeItems<T extends { id: string }>(
  current: T[],
  before: T[],
  edited: T[],
  content: (item: T) => unknown = (item) => item,
  replace: (current: T, edited: T) => T = (_, item) => item,
): T[] | null {
  const originals = new Map(before.map((item) => [item.id, item]));
  const updates = new Map(edited.map((item) => [item.id, item]));
  const latest = new Map(current.map((item) => [item.id, item]));
  const changed = new Set<string>();
  for (const id of new Set([...originals.keys(), ...updates.keys()])) {
    const original = originals.get(id);
    const update = updates.get(id);
    const present = latest.get(id);
    if (sameValue(original && content(original), update && content(update)))
      continue;
    if (!sameValue(original && content(original), present && content(present)))
      return null;
    changed.add(id);
  }
  if (!changed.size) return current;
  const merged: T[] = [];
  for (const item of current) {
    if (!changed.has(item.id)) merged.push(item);
    else {
      const update = updates.get(item.id);
      if (update) merged.push(replace(item, update));
    }
  }
  for (const item of edited) {
    if (!originals.has(item.id) && changed.has(item.id)) merged.push(item);
  }
  return merged;
}

/** Rebase the form's changes, including connected default outputs, onto the live graph. */
export function applyNodeFormDraft(
  current: Definition,
  before: Definition,
  edited: Definition,
  nodeId: string,
): Definition | null {
  const originalNode = before.nodes.find((node) => node.id === nodeId);
  const editedNode = edited.nodes.find((node) => node.id === nodeId);
  const currentNode = current.nodes.find((node) => node.id === nodeId);
  if (
    !originalNode ||
    !editedNode ||
    !currentNode ||
    editedNode.type !== originalNode.type ||
    currentNode.type !== originalNode.type
  )
    return null;
  const changedInputs =
    originalNode.type === "INPUT" && !sameValue(before.inputs, edited.inputs);
  if (changedInputs && !sameValue(before.inputs, current.inputs)) return null;
  const nodes = mergeItems(
    current.nodes,
    before.nodes,
    edited.nodes,
    nodeFields,
    (present, update) => ({ ...update, position: present.position }),
  );
  const edges = mergeItems(current.edges, before.edges, edited.edges);
  if (!nodes || !edges) return null;
  for (const edge of edges) {
    const previousSource = current.nodes.find(
      (node) => node.id === edge.source,
    );
    const source = nodes.find((node) => node.id === edge.source);
    const removedSource = previousSource && !source;
    const removedTarget =
      current.nodes.some((node) => node.id === edge.target) &&
      !nodes.some((node) => node.id === edge.target);
    const removedPort =
      previousSource &&
      source &&
      sourcePorts(previousSource).some(
        (port) => port.id === edge.sourceHandle,
      ) &&
      !sourcePorts(source).some((port) => port.id === edge.sourceHandle);
    // A new live connection must not become dangling when a form removes its
    // node or port. Existing incomplete draft connections remain editable.
    if (removedSource || removedTarget || removedPort) return null;
  }
  if (nodes === current.nodes && edges === current.edges && !changedInputs)
    return current;
  return {
    ...current,
    nodes,
    edges,
    inputs: changedInputs ? edited.inputs : current.inputs,
  };
}
