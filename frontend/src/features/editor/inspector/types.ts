import type { Rule, RuleNode } from "../../../types";
import type { DefinitionChange } from "../../../domain/graph";
import type { VariableOption } from "../../../domain/variables";
import type { ReferenceTarget } from "../types";
export interface NodeFieldsProps {
  rule: Rule;
  node: RuleNode;
  readOnly: boolean;
  /** The node's scope; empty while `scopeKnown` is false. */
  variables: VariableOption[];
  /**
   * False while the scope read is pending or failed: controls then keep the
   * values they hold instead of judging them unavailable.
   */
  scopeKnown: boolean;
  patch: (patch: Partial<RuleNode>) => void;
  /**
   * Applies a change to the whole draft. `group` joins quick repeats of one
   * edit into one Undo step when the change rewrites several nodes, as a
   * rename that carries the expressions reading the name does.
   */
  onDefinitionChange: (change: DefinitionChange, group?: string) => void;
  onInvalidDefault: (key: string, invalid: boolean) => void;
  onOpenReference: (target: ReferenceTarget) => void;
}
