import type { RuleSummary, Rule } from "../../types";
import type { GraphProblem } from "../../api/errors";
export interface ReferenceTarget {
  ruleId: string;
  version: number;
  nodeId?: string;
  mode?: "graph" | "code";
  problems?: GraphProblem[];
}

export interface EditorProps {
  mode: "code" | "graph";
  rule: Rule;
  rules: RuleSummary[];
  requestedVersion: number | null;
  requestedNode?: string | null;
  onSaved: (r: Rule) => void;
  onDirty: (value: boolean) => void;
  navigate: (path: string) => void;
  notify: (message: string) => void;
  embedded?: boolean;
  onOpenReference?: (target: ReferenceTarget, fromNode?: string) => void;
  initialProblems?: GraphProblem[];
}
