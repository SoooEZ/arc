import { Button } from "@mui/material";
import { Plus } from "lucide-react";
import { inputVariables } from "../../../domain/graph";
import InputParameterCard from "./InputParameterCard";
import { useInputParameterRows } from "./useInputParameterRows";
import type { NodeFieldsProps } from "./types";
import InspectorSection from "./InspectorSection";

export default function InputFields({
  rule,
  readOnly,
  onDefinitionChange,
  onInvalidJson,
}: NodeFieldsProps) {
  const allVariables = inputVariables(rule.draft);
  const parameters = useInputParameterRows(
    rule.draft.inputs,
    onDefinitionChange,
  );
  return (
    <InspectorSection title="Input parameters" count={rule.draft.inputs.length}>
      {parameters.rows.map(({ input, index, id }) => (
        <InputParameterCard
          key={id}
          input={input}
          index={index}
          readOnly={readOnly}
          variables={allVariables.filter(
            (variable) =>
              variable.name !== input.name && variable.type !== "RESULT",
          )}
          onChange={(patch) => parameters.change(index, patch)}
          onRemove={() => parameters.remove(index)}
          onValidity={(valid) => onInvalidJson(id, !valid)}
        />
      ))}
      {!readOnly && (
        <Button
          size="small"
          fullWidth
          variant="outlined"
          startIcon={<Plus size={14} />}
          onClick={parameters.add}
        >
          Add parameter
        </Button>
      )}
    </InspectorSection>
  );
}
