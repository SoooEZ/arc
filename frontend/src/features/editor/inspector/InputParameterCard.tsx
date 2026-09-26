import {
  FormControlLabel,
  IconButton,
  MenuItem,
  Switch,
  TextField,
  Tooltip,
} from "@mui/material";
import { Braces, Trash2 } from "lucide-react";
import { useState } from "react";
import type { Input, InputType } from "../../../types";
import type { VariableOption } from "../../../domain/graph";
import {
  acceptsParameterNameEdit,
  parameterNameError,
  parameterNameGuidance,
} from "../../../domain/identifiers";
import SourceBindingEditor from "../../sources/SourceBindingEditor";
import InputDefaultValue from "./InputDefaultValue";

export default function InputParameterCard({
  input,
  index,
  readOnly,
  variables,
  onChange,
  onRemove,
  onValidity,
}: {
  input: Input;
  index: number;
  readOnly: boolean;
  variables: VariableOption[];
  onChange: (patch: Partial<Input>) => void;
  onRemove: () => void;
  onValidity: (valid: boolean) => void;
}) {
  const [rejectedNameEdit, setRejectedNameEdit] = useState(false);
  const nameError = rejectedNameEdit
    ? parameterNameGuidance
    : parameterNameError(input.name);
  return (
    <div className="input-schema-card">
      <div className="input-card-title">
        <Braces size={14} />
        <span>Parameter {index + 1}</span>
        <FormControlLabel
          className="input-required-toggle"
          control={
            <Switch
              size="small"
              checked={input.required}
              disabled={readOnly}
              onChange={(_, required) => onChange({ required })}
            />
          }
          label={input.required ? "Required" : "Optional"}
        />
        <Tooltip title="Remove parameter">
          <span>
            <IconButton
              size="small"
              aria-label={`Remove ${input.name}`}
              disabled={readOnly}
              onClick={onRemove}
            >
              <Trash2 size={13} />
            </IconButton>
          </span>
        </Tooltip>
      </div>
      <TextField
        label="Parameter name"
        value={input.name}
        disabled={readOnly}
        error={!!nameError}
        helperText={nameError || parameterNameGuidance}
        onChange={(event) => {
          if (readOnly) return;
          const name = event.target.value;
          const accepted = acceptsParameterNameEdit(name);
          setRejectedNameEdit(!accepted);
          if (accepted) onChange({ name });
        }}
        onPaste={(event) => {
          // Single-line inputs strip tabs/newlines before onChange; reject the original paste.
          if (/[\s$]/u.test(event.clipboardData.getData("text"))) {
            event.preventDefault();
            setRejectedNameEdit(true);
          }
        }}
      />
      <TextField
        select
        label="Type"
        value={input.type}
        disabled={readOnly}
        onChange={(event) =>
          onChange({
            type: event.target.value as InputType,
            defaultValue: null,
          })
        }
      >
        {(["NUMBER", "STRING", "BOOLEAN", "ARRAY", "OBJECT"] as const).map(
          (type) => (
            <MenuItem key={type} value={type}>
              {type.toLowerCase()}
            </MenuItem>
          ),
        )}
      </TextField>
      <InputDefaultValue
        key={input.type}
        input={input}
        disabled={readOnly}
        onValidity={onValidity}
        onChange={(defaultValue) => onChange({ defaultValue })}
      />
      <SourceBindingEditor
        input={input}
        variables={variables}
        readOnly={readOnly}
        onChange={(source) => onChange({ source })}
      />
    </div>
  );
}
