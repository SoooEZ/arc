import type { Definition, RuleNode } from "../types";

/**
 * The drafts Undo and Redo step to. `past` holds the drafts before each step,
 * oldest first; `future` holds the drafts Undo stepped away from, the next one
 * last. A new edit clears `future`.
 */
export interface DraftHistory {
  past: readonly Definition[];
  future: readonly Definition[];
  /** The last recorded edit, which a quick repeat of the same edit joins. */
  last: { group: string; at: number } | null;
}

export const noHistory: DraftHistory = { past: [], future: [], last: null };

/** Undo goes back at most this many steps. */
const historyLimit = 100;
/** Edits of one group this close together are one step: a word typed, a card dragged. */
const joinWithinMs = 1000;

/**
 * The history after `before` became `after` at `at` (ms). An edit joins the
 * previous step when both belong to one group (see editGroup) and follow
 * each other within a second, so Undo reverts a burst of typing or a whole
 * drag. An edit without a time, such as Arrange or a code build, is always a
 * step of its own.
 */
export function recordEdit(
  history: DraftHistory,
  before: Definition,
  after: Definition,
  at?: number,
): DraftHistory {
  const past = [...history.past, before].slice(-historyLimit);
  const group = at === undefined ? null : editGroup(before, after);
  if (at === undefined || group === null)
    return { past, future: [], last: null };
  const last = history.last;
  if (last?.group === group && at - last.at <= joinWithinMs)
    return { past: history.past, future: [], last: { group, at } };
  return { past, future: [], last: { group, at } };
}

/** The history after Undo replaced `current` with the last past draft. */
export function steppedBack(
  history: DraftHistory,
  current: Definition,
): DraftHistory {
  return {
    past: history.past.slice(0, -1),
    future: [...history.future, current],
    last: null,
  };
}

/** The history after Redo replaced `current` with the next future draft. */
export function steppedForward(
  history: DraftHistory,
  current: Definition,
): DraftHistory {
  return {
    past: [...history.past, current].slice(-historyLimit),
    future: history.future.slice(0, -1),
    last: null,
  };
}

/**
 * Which repeatable edit turned `before` into `after`: moving the same cards,
 * or changing the same fields of one node or of the inputs, as typing does.
 * Null for an edit that is a step of its own: adding, removing or connecting
 * nodes, or changing several nodes at once. Graph mutations keep the objects
 * they do not change, so identity tells what changed.
 */
export function editGroup(
  before: Definition,
  after: Definition,
): string | null {
  if (
    before.edges !== after.edges ||
    before.nodes.length !== after.nodes.length
  )
    return null;
  const changed: [RuleNode, RuleNode][] = [];
  for (let index = 0; index < before.nodes.length; index++) {
    const earlier = before.nodes[index];
    const later = after.nodes[index];
    if (earlier.id !== later.id) return null;
    if (earlier !== later) changed.push([earlier, later]);
  }
  if (!changed.length) return before.inputs === after.inputs ? null : "inputs";
  if (before.inputs !== after.inputs) return null;
  const fields = changed.map(([earlier, later]) =>
    changedFields(earlier, later),
  );
  if (fields.every((names) => names.length === 1 && names[0] === "position"))
    return `move:${changed.map(([node]) => node.id).join(",")}`;
  if (changed.length !== 1) return null;
  return `node:${changed[0][0].id}:${fields[0].join(",")}`;
}

function changedFields(earlier: RuleNode, later: RuleNode): string[] {
  const before = new Map(Object.entries(earlier));
  const after = new Map(Object.entries(later));
  return [...new Set([...before.keys(), ...after.keys()])]
    .filter((name) => before.get(name) !== after.get(name))
    .sort();
}
