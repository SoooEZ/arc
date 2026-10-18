import { useRef } from "react";
import { TextField } from "@mui/material";
import {
  acceptsIdentifierEdit,
  identifierError,
  identifierGuidance,
} from "../../../domain/identifiers";
import { useRefusedEdit } from "../../../hooks/useRefusedEdit";

/** A refused edit explains the rule; an empty optional name is valid. */
function fieldError(
  value: string,
  optional: boolean,
  refused: boolean,
): string | null {
  if (refused) return identifierGuidance;
  if (optional && value === "") return null;
  return identifierError(value);
}

/**
 * Parameter and result names share the expression language's identifier
 * contract. The naming rule shows when a name breaks it or an edit is
 * refused; a valid name shows only the field's own help.
 */
export default function IdentifierField({
  label,
  value,
  disabled,
  optional = false,
  autoFocus = false,
  helperText,
  onChange,
}: {
  label: string;
  value: string;
  disabled: boolean;
  optional?: boolean;
  autoFocus?: boolean;
  helperText?: string;
  onChange: (value: string) => void;
}) {
  const edit = useRefusedEdit(value);
  const error = fieldError(value, optional, edit.refused);
  // A field focused for the user (a new parameter's generated name) starts
  // selected, so typing replaces the name instead of appending to it.
  const selectOnFocus = useRef(autoFocus);
  return (
    <TextField
      label={label}
      value={value}
      disabled={disabled}
      autoFocus={autoFocus}
      onFocus={(event) => {
        if (!selectOnFocus.current) return;
        selectOnFocus.current = false;
        event.target.select();
      }}
      error={!!error}
      helperText={error || helperText}
      onChange={(event) => {
        if (disabled) return;
        const name = event.target.value;
        if (!acceptsIdentifierEdit(value, name)) {
          edit.refuse();
          return;
        }
        edit.clear();
        onChange(name);
      }}
      onPaste={edit.onPaste}
    />
  );
}
