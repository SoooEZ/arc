import ExpressionField from "../../expressions/ExpressionField";
import type { NodeFieldsProps } from "./types";
import InspectorSection from "./InspectorSection";

export default function FormulaFields({
  node,
  readOnly,
  patch,
  variables,
  scopeKnown,
}: NodeFieldsProps) {
  return (
    <InspectorSection
      title="Expression"
      help="Calculate a value using available inputs, upstream results, functions and pinned Formula calls."
    >
      <ExpressionField
        label="Expression"
        value={node.expression || ""}
        onChange={(expression) => patch({ expression })}
        variables={variables}
        scopeKnown={scopeKnown}
        disabled={readOnly}
        helperText="Nested functions, arrays, object fields and arithmetic are supported."
      />
    </InspectorSection>
  );
}
