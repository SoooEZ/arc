import { useCallback, useRef } from "react";
import { Button, Tooltip } from "@mui/material";
import { Plus } from "lucide-react";
import type { Definition } from "../../../types";
import { inputVariables, type VariableOption } from "../../../domain/variables";
import { canAddInput, MAX_INPUTS } from "../../../domain/limits";
import InputParameterCard from "./InputParameterCard";
import { useInputParameterRows } from "./useInputParameterRows";
import { sameVariableOptions } from "./useNodeVariables";
import type { NodeFieldsProps } from "./types";
import InspectorSection from "./InspectorSection";

const noVariables: VariableOption[] = [];

/** The input variables as one array while their names, types and labels stay, so memoized cards see one prop. */
function useInputVariables(definition: Definition): VariableOption[] {
  const previous = useRef<VariableOption[]>([]);
  const variables = inputVariables(definition);
  if (!sameVariableOptions(previous.current, variables))
    previous.current = variables;
  return previous.current;
}

export default function InputFields({
  rule,
  readOnly,
  onDefinitionChange,
  onInvalidDefault,
}: NodeFieldsProps) {
  const allVariables = useInputVariables(rule.draft);
  const parameters = useInputParameterRows(
    rule.draft.inputs,
    onDefinitionChange,
  );
  const onValidity = useCallback(
    (id: string, valid: boolean) => onInvalidDefault(id, !valid),
    [onInvalidDefault],
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
          rowId={id}
          input={input}
          index={index}
          readOnly={readOnly}
          // Variables are mapped into a source binding's parameters: a card
          // without a source shows none, so a name typed in another card
          // leaves it alone (lesson F39).
          variables={input.source ? allVariables : noVariables}
          onChange={parameters.change}
          onRemove={parameters.remove}
          onValidity={onValidity}
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
