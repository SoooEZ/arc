import { Button } from "@mui/material";
import { Plus } from "lucide-react";
import { inputVariables } from "../../../domain/graph";
import InputParameterCard from "./InputParameterCard";
import { useInputParameterRows } from "./useInputParameterRows";
import type { NodeFieldsProps } from "./types";

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
    <div className="inspector-section">
      <div className="section-title">
        <h4>Input parameters</h4>
        <span>{rule.draft.inputs.length}</span>
      </div>
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
    </div>
  );
}
