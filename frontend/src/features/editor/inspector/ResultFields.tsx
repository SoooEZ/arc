import { TextField } from "@mui/material";
import type { NodeFieldsProps } from "./types";
import InspectorSection from "./InspectorSection";

export default function ResultFields({
  node,
  readOnly,
  patch,
}: NodeFieldsProps) {
  if (!["FORMULA", "REFERENCE", "TRANSFORM"].includes(node.type)) return null;
  return (
    <InspectorSection
      title="Output As"
      help="Name this node’s result so connected downstream nodes can use it in variables and expressions."
    >
      <TextField
        label="Result variable"
        value={node.output || ""}
        onChange={(event) => patch({ output: event.target.value })}
        helperText="Use this variable in later nodes."
        disabled={readOnly}
      />
    </InspectorSection>
  );
}
