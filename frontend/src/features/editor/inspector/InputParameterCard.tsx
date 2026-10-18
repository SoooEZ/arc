import { memo, useMemo } from "react";
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
import SourceBindingEditor from "../../sources/binding/SourceBindingEditor";
import InputDefaultValue from "./InputDefaultValue";

/**
 * One parameter. Memoized with row-identity callbacks: a keystroke in one
 * card, or a drag frame of another node, renders that card alone (lesson F39).
 */
export default memo(function InputParameterCard({
  rowId,
  input,
  index,
  readOnly,
  variables,
  focusName,
  unused,
  onChange,
  onRename,
  onRemove,
  onValidity,
}: {
  /** The row's UI-only identity, which the callbacks take back. */
  rowId: string;
  input: Input;
  index: number;
  readOnly: boolean;
  /** The input variables a source binding may map; none while the card has no source. */
  variables: VariableOption[];
  /** Focus the name field as the card appears: Add parameter just added it. */
  focusName: boolean;
  /** No expression, mapping or source binding of the rule reads the parameter. */
  unused: boolean;
  onChange: (rowId: string, patch: Partial<Input>) => void;
  /** Renames the parameter and the expressions that read it. */
  onRename: (rowId: string, name: string) => void;
  onRemove: (rowId: string) => void;
  onValidity: (rowId: string, valid: boolean) => void;
}) {
  const change = (patch: Partial<Input>) => onChange(rowId, patch);
  // A parameter cannot be mapped into its own source read.
  const choices = useMemo(
    () =>
      variables.filter(
        (variable) =>
          variable.name !== input.name && variable.type !== "RESULT",
      ),
    [variables, input.name],
  );
  return (
    <div className="input-schema-card">
      <div className="input-card-title">
        <strong>{input.name || `Parameter ${index + 1}`}</strong>
        {unused && (
          <Tooltip
            title={`No step reads ${input.name} yet. Use it in an expression or a mapping, or remove it.`}
          >
            <span className="input-unused">Not used</span>
          </Tooltip>
        )}
        <FormControlLabel
          className="input-required-toggle"
          control={
            <Switch
              size="small"
              checked={input.required}
              disabled={readOnly}
              onChange={(_, required) => change({ required })}
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
              onClick={() => onRemove(rowId)}
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
        autoFocus={focusName}
        onChange={(name) => onRename(rowId, name)}
      />
      <TextField
        select
        label="Type"
        value={input.type}
        disabled={readOnly}
        onChange={(event) => {
          const type = inputTypeOf(event.target.value);
          if (type) change({ type, defaultValue: null });
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
        onValidity={(valid) => onValidity(rowId, valid)}
        onChange={(defaultValue) => change({ defaultValue })}
      />
      <SourceBindingEditor
        input={input}
        variables={choices}
        readOnly={readOnly}
        onChange={(source) => change({ source })}
      />
    </div>
  );
});
