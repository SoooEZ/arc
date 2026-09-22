import {
  FormControlLabel,
  IconButton,
  MenuItem,
  Switch,
  TextField,
  Tooltip,
} from "@mui/material";
import { Braces, Trash2 } from "lucide-react";
import type { DataSource, Input, InputType } from "../../../types";
import type { VariableOption } from "../../../domain/graph";
import SourceBindingEditor from "../../sources/SourceBindingEditor";
import InputDefaultValue from "./InputDefaultValue";

export default function InputParameterCard({
  input,
  index,
  readOnly,
  variables,
  sources,
  sourceError,
  onChange,
  onRemove,
  onValidity,
}: {
  input: Input;
  index: number;
  readOnly: boolean;
  variables: VariableOption[];
  sources: DataSource[];
  sourceError: string;
  onChange: (patch: Partial<Input>) => void;
  onRemove: () => void;
  onValidity: (valid: boolean) => void;
}) {
  return (
    <div className="input-schema-card">
      <div className="input-card-title">
        <Braces size={14} />
        <span>Parameter {index + 1}</span>
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
        onChange={(event) => onChange({ name: event.target.value })}
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
        sources={sources}
        sourceError={sourceError}
        readOnly={readOnly}
        onChange={(source) => onChange({ source })}
      />
      <FormControlLabel
        control={
          <Switch
            size="small"
            checked={input.required}
            disabled={readOnly}
            onChange={(_, required) => onChange({ required })}
          />
        }
        label="Required"
      />
    </div>
  );
}
