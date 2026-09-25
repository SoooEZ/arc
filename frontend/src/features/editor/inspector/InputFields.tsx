import { useState } from "react";
import { Button, TextField } from "@mui/material";
import { Plus } from "lucide-react";
import { sourceApi } from "../../../api/sources";
import { inputVariables } from "../../../domain/graph";
import { usePagedResource } from "../../../hooks/usePagedResource";
import CatalogPagination from "../../../components/CatalogPagination";
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
  const [search, setSearch] = useState("");
  const sources = usePagedResource(search, (offset, limit, signal) =>
    sourceApi.catalog({ offset, limit, search }, { signal }),
  );
  return (
    <div className="inspector-section">
      <div className="section-title">
        <h4>Input parameters</h4>
        <span>{rule.draft.inputs.length}</span>
      </div>
      <TextField
        label="Find value provider"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <CatalogPagination
        label="Value providers"
        offset={sources.offset}
        limit={sources.limit}
        total={sources.data.total}
        loading={sources.loading}
        onPage={sources.setOffset}
      />
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
          sources={sources.data.items}
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
