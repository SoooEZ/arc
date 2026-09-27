import ValueBinding from "../../expressions/ValueBinding";
import IdentifierField from "./IdentifierField";
import type { NodeFieldsProps } from "./types";

export default function OutputValueFields({
  node,
  variables,
  readOnly,
  patch,
  label = "Return value",
}: Pick<NodeFieldsProps, "node" | "variables" | "readOnly" | "patch"> & {
  label?: string;
}) {
  return (
    <>
      <ValueBinding
        key={node.id}
        label={label}
        type="ANY"
        value={node.expression ?? undefined}
        variables={variables}
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
        helperText="Optional. Return an object with this field name; leave blank to return the value directly."
      />
      <div className="expression-preview" aria-label="Return value preview">
        <code>
          {node.outputName
            ? `{ ${JSON.stringify(node.outputName)}: ${node.expression || "…"} }`
            : node.expression || "Choose a return value"}
        </code>
      </div>
    </>
  );
}
