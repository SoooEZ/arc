import type { Rule } from "../../types";
import type { GraphProblem } from "../../api/errors";
import type { ReferenceLocation } from "../execution/types";

/** A referenced rule to open: the location execution reports, and how to show it. */
export interface ReferenceTarget extends ReferenceLocation {
  mode?: "graph" | "code";
  problems?: GraphProblem[];
}

export interface EditorProps {
  mode: "code" | "graph";
  rule: Rule;
  requestedVersion: number | null;
  requestedNode?: string | null;
  onSaved: (r: Rule) => void;
  onDirty: (value: boolean) => void;
  /** Offers deleting the rule from its settings; told once it is deleted. */
  onDeleted?: (id: string) => void;
  navigate: (path: string) => void;
  /**
   * Corrects a refused arrival (see useWorkspaceNavigation.redirect) without
   * adding a history entry; embedded viewers fall back to `navigate`.
   */
  redirect?: (path: string) => void;
  notify: (message: string) => void;
  embedded?: boolean;
  onOpenReference?: (target: ReferenceTarget, fromNode?: string) => void;
  initialProblems?: GraphProblem[];
}
