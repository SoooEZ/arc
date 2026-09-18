import type { Rule } from "../../types";
import type { GraphProblem } from "../../api/errors";
import type { ReferenceTarget } from "../../components/ReferenceDialog";
export interface EditorProps {
  mode: "code" | "graph";
  rule: Rule;
  rules: Rule[];
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
