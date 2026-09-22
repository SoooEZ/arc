import { Button } from "@mui/material";
import { Plus } from "lucide-react";
import type { DataSource } from "../../../types";
import { sourceApi } from "../../../api/sources";
import { inputVariables } from "../../../domain/graph";
import { useAsyncResource } from "../../../hooks/useAsyncResource";
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
  // One catalog read serves every parameter card in this Input inspector.
  const sources = useAsyncResource(
    "source-catalog",
    (signal) => sourceApi.sources({ signal }),
    [] as DataSource[],
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
          sources={sources.data}
          sourceError={sources.error}
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
