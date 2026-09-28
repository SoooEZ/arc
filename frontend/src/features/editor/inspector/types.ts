import type { Definition, Rule, RuleNode } from "../../../types";
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
  onDefinitionChange: (change: (definition: Definition) => Definition) => void;
  onInvalidDefault: (key: string, invalid: boolean) => void;
  onOpenReference: (target: ReferenceTarget) => void;
}
