import type { BranchCase, RuleNode } from "../types";
import { nodeKinds } from "./nodeKinds";
export const branchHandleX = { true: 0.27, false: 0.73 } as const;

/**
 * The connection handles a node kind exposes (the server's `Handles`): one
 * owner for the IDs that edges store in `sourceHandle`.
 */
export const handles = {
  next: "next",
  true: "true",
  false: "false",
  default: "default",
} as const;

/** The handle of a Switch case: its ID never depends on the case's position. */
function caseHandle(caseId: string): string {
  return `case:${caseId}`;
}

/** The caption and fallback status of the fixed exits, which every graph shares. */
const fixedExits: Record<
  "true" | "false" | "default",
  { label: string; fallback: boolean }
> = {
  true: { label: "True", fallback: false },
  false: { label: "False", fallback: true },
  default: { label: "Default", fallback: true },
};

/** The caption of a handle that needs no node to read: the fixed exits; null for `next` and case handles. */
export function fixedExitCaption(
  handleId: string,
): { label: string; fallback: boolean } | null {
  return Object.hasOwn(fixedExits, handleId)
    ? fixedExits[handleId as keyof typeof fixedExits]
    : null;
}

export interface SourcePort {
  id: string;
  label: string;
  ratio: number;
  /** Taken when the others are not: a Condition's False and a Switch's Default. */
  fallback: boolean;
}

const cardWidth = 230;
/** Room for one exit label; a Switch with many cases widens its card to fit them. */
const exitSpacing = 90;

function casePorts(cases: BranchCase[]): SourcePort[] {
  const branches = [
    ...cases.map((option) => ({
      id: caseHandle(option.id),
      label: option.label,
      fallback: false,
    })),
    { id: handles.default, ...fixedExits.default },
  ];
  return branches.map((branch, index) => ({
    ...branch,
    ratio: (index + 0.5) / branches.length,
  }));
}

/** Shared by canvas, layout, previews and graph mutations; branch IDs never depend on order. */
export function sourcePorts(node: RuleNode): SourcePort[] {
  switch (nodeKinds[node.type].exits) {
    case "none":
      return [];
    case "next":
      return [{ id: handles.next, label: "", ratio: 0.5, fallback: false }];
    case "true-false":
      return [
        { id: handles.true, ratio: branchHandleX.true, ...fixedExits.true },
        { id: handles.false, ratio: branchHandleX.false, ...fixedExits.false },
      ];
    case "cases":
      return casePorts(node.cases ?? []);
  }
}

/** The port `handleId` names on `node`, or undefined when the node has no such exit. */
export function sourcePort(
  node: RuleNode,
  handleId: string,
): SourcePort | undefined {
  return sourcePorts(node).find((port) => port.id === handleId);
}

/** Whether the node has an incoming handle; the Input node starts every path. */
export function hasTargetPort(node: RuleNode): boolean {
  return nodeKinds[node.type].acceptsIncoming;
}

export function nodeWidth(node: RuleNode): number {
  return Math.max(cardWidth, sourcePorts(node).length * exitSpacing);
}
