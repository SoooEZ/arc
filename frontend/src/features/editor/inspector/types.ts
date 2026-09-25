import type { Definition, RuleSummary, Rule, RuleNode } from "../../../types";
import type { VariableOption } from "../../../domain/graph";
import type { ReferenceTarget } from "../types";
export interface NodeFieldsProps {
  rule: Rule;
  node: RuleNode;
  rules: RuleSummary[];
  readOnly: boolean;
  variables: VariableOption[];
  patch: (patch: Partial<RuleNode>) => void;
  onDefinitionChange: (change: (definition: Definition) => Definition) => void;
  onInvalidJson: (key: string, invalid: boolean) => void;
  onOpenReference: (target: ReferenceTarget) => void;
}
