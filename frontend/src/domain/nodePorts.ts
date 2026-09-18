import type { RuleNode } from "../types";
export const branchHandleX = { true: 0.27, false: 0.73 } as const;

export interface SourcePort {
  id: string;
  label: string;
  ratio: number;
}

/** Shared by canvas, layout and graph mutations; branch IDs never depend on order. */
export function sourcePorts(node: RuleNode): SourcePort[] {
  if (node.type === "OUTPUT") return [];
  if (node.type === "CONDITION")
    return [
      { id: "true", label: "True", ratio: branchHandleX.true },
      { id: "false", label: "False", ratio: branchHandleX.false },
    ];
  if (node.type === "SWITCH") {
    const branches = [
      ...(node.cases ?? []).map((option) => ({
        id: `case:${option.id}`,
        label: option.label,
      })),
      { id: "default", label: "Default" },
    ];
    return branches.map((branch, index) => ({
      ...branch,
      ratio: (index + 0.5) / branches.length,
    }));
  }
  return [{ id: "next", label: "", ratio: 0.5 }];
}

export function nodeWidth(node: RuleNode): number {
  return node.type === "SWITCH"
    ? Math.max(230, sourcePorts(node).length * 90)
    : 230;
}
