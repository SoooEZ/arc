import type { NodeFieldsProps } from "./types";
import InspectorSection from "./InspectorSection";
import IdentifierField from "./IdentifierField";

/** The result variable of a kind that stores one (see domain/nodeKinds). */
export default function ResultFields({
  node,
  readOnly,
  patch,
}: NodeFieldsProps) {
  return (
    <InspectorSection
      title="Output As"
      help="Name this node’s result so connected downstream nodes can use it in variables and expressions."
    >
      <IdentifierField
        label="Result variable"
        value={node.output || ""}
        onChange={(output) => patch({ output: output || null })}
        helperText="Use this variable in later nodes."
        disabled={readOnly}
      />
    </InspectorSection>
  );
}
