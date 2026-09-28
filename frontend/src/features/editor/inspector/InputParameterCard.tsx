import {
  FormControlLabel,
  IconButton,
  MenuItem,
  Switch,
  TextField,
  Tooltip,
} from "@mui/material";
import { Trash2 } from "lucide-react";
import type { Input } from "../../../types";
import type { VariableOption } from "../../../domain/variables";
import {
  inputTypeFacts,
  inputTypeOf,
  inputTypes,
} from "../../../domain/inputTypes";
import IdentifierField from "./IdentifierField";
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
  return (
    <div className="input-schema-card">
      <div className="input-card-title">
        <strong>{input.name || `Parameter ${index + 1}`}</strong>
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
      <IdentifierField
        label="Parameter name"
        value={input.name}
        disabled={readOnly}
        onChange={(name) => onChange({ name })}
      />
      <TextField
        select
        label="Type"
        value={input.type}
        disabled={readOnly}
        onChange={(event) => {
          const type = inputTypeOf(event.target.value);
          if (type) onChange({ type, defaultValue: null });
        }}
      >
        {inputTypes.map((type) => (
          <MenuItem key={type} value={type}>
            {inputTypeFacts[type].label}
          </MenuItem>
        ))}
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
