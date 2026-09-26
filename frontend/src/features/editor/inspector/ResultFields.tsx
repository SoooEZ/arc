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
    <InspectorSection title="Output As">
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
