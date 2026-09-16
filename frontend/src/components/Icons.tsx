import {
  Braces,
  Calculator,
  GitBranch,
  LogIn,
  LogOut,
  Workflow,
} from "lucide-react";
import type { Kind, NodeType } from "../types";

export function KindIcon({ kind, size = 20 }: { kind: Kind; size?: number }) {
  const Icon =
    kind === "DECISION_TREE"
      ? Workflow
      : kind === "FORMULA"
        ? Calculator
        : GitBranch;
  return <Icon size={size} strokeWidth={1.7} />;
}
export function NodeIcon({
  type,
  size = 17,
}: {
  type: NodeType;
  size?: number;
}) {
  const Icon = {
    INPUT: LogIn,
    FORMULA: Calculator,
    CONDITION: GitBranch,
    REFERENCE: Braces,
    OUTPUT: LogOut,
  }[type];
  return <Icon size={size} strokeWidth={1.8} />;
}
export function ArcMark() {
  return (
    <svg
      width="31"
      height="31"
      viewBox="0 0 40 40"
      fill="none"
      aria-hidden="true"
    >
      <rect width="40" height="40" rx="10" fill="#bfe9b6" />
      <path
        d="m10 29 10-19 10 19M14 23h12"
        stroke="#173c2c"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <circle cx="20" cy="10" r="2.5" fill="#173c2c" />
    </svg>
  );
}
