import type { BranchCase, RuleNode } from "../types";
import { nodeKinds } from "./nodeKinds";
export const branchHandleX = { true: 0.27, false: 0.73 } as const;

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
      id: `case:${option.id}`,
      label: option.label,
      fallback: false,
    })),
    { id: "default", label: "Default", fallback: true },
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
      return [{ id: "next", label: "", ratio: 0.5, fallback: false }];
    case "true-false":
      return [
        {
          id: "true",
          label: "True",
          ratio: branchHandleX.true,
          fallback: false,
        },
        {
          id: "false",
          label: "False",
          ratio: branchHandleX.false,
          fallback: true,
        },
      ];
    case "cases":
      return casePorts(node.cases ?? []);
  }
}

/** Whether the node has an incoming handle; the Input node starts every path. */
export function hasTargetPort(node: RuleNode): boolean {
  return nodeKinds[node.type].acceptsIncoming;
}

export function nodeWidth(node: RuleNode): number {
  return Math.max(cardWidth, sourcePorts(node).length * exitSpacing);
}
