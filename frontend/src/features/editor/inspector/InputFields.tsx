import { Button, Tooltip } from "@mui/material";
import { Plus } from "lucide-react";
import { inputVariables } from "../../../domain/graph";
import { canAddInput, MAX_INPUTS } from "../../../domain/limits";
import InputParameterCard from "./InputParameterCard";
import { useInputParameterRows } from "./useInputParameterRows";
import type { NodeFieldsProps } from "./types";
import InspectorSection from "./InspectorSection";

export default function InputFields({
  rule,
  readOnly,
  onDefinitionChange,
  onInvalidDefault,
}: NodeFieldsProps) {
  const allVariables = inputVariables(rule.draft);
  const parameters = useInputParameterRows(
    rule.draft.inputs,
    onDefinitionChange,
  );
  return (
    <InspectorSection
      title="Input parameters"
      help="Define the names and types of data this rule accepts. Each parameter can require a value or use a default or data source."
      count={rule.draft.inputs.length}
    >
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
          onValidity={(valid) => onInvalidDefault(id, !valid)}
        />
      ))}
      {!readOnly && (
        <Tooltip
          title={
            canAddInput(rule.draft)
              ? ""
              : `A rule declares at most ${MAX_INPUTS} input parameters`
          }
        >
          <span>
            <Button
              size="small"
              fullWidth
              variant="outlined"
              startIcon={<Plus size={14} />}
              disabled={!canAddInput(rule.draft)}
              onClick={parameters.add}
            >
              Add parameter
            </Button>
          </span>
        </Tooltip>
      )}
    </InspectorSection>
  );
}
