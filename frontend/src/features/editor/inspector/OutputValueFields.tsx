import ValueBinding from "../../expressions/ValueBinding";
import { multipleOutputFieldName } from "../../../domain/outputNames";
import IdentifierField from "./IdentifierField";
import type { NodeFieldsProps } from "./types";

export default function OutputValueFields({
  rule,
  node,
  variables,
  scopeKnown,
  readOnly,
  patch,
  label = "Return value",
}: Pick<
  NodeFieldsProps,
  "rule" | "node" | "variables" | "scopeKnown" | "readOnly" | "patch"
> & {
  label?: string;
}) {
  const value = node.expression || "…";
  const returnedValue = node.outputName
    ? `{ ${JSON.stringify(node.outputName)}: ${value} }`
    : value;
  const hasOtherOutputs = rule.draft.nodes.some(
    (other) => other.type === "OUTPUT" && other.id !== node.id,
  );
  return (
    <>
      <ValueBinding
        key={node.id}
        label={label}
        type="ANY"
        value={node.expression ?? undefined}
        variables={variables}
        scopeKnown={scopeKnown}
        disabled={readOnly}
        optional={false}
        onChange={(value) => patch({ expression: value ?? "" })}
      />
      <IdentifierField
        label="Output name"
        value={node.outputName || ""}
        optional
        disabled={readOnly}
        onChange={(outputName) => patch({ outputName: outputName || null })}
        helperText="Optional result field name. With multiple Outputs, unnamed variables use their own name; other values use the node ID."
      />
      <div
        className="expression-preview output-return-preview"
        aria-label="Return value preview"
      >
        <span>When only this Output runs</span>
        <code>{returnedValue}</code>
        {hasOtherOutputs && (
          <>
            <span>When multiple Outputs run · this field</span>
            <code>{`{ ${JSON.stringify(multipleOutputFieldName(node))}: ${value}, … }`}</code>
          </>
        )}
      </div>
    </>
  );
}
