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

/** Parameter and result names share the expression language's identifier contract. */
export default function IdentifierField({
  label,
  value,
  disabled,
  optional = false,
  helperText,
  onChange,
}: {
  label: string;
  value: string;
  disabled: boolean;
  optional?: boolean;
  helperText?: string;
  onChange: (value: string) => void;
}) {
  const edit = useRefusedEdit(value);
  const error = fieldError(value, optional, edit.refused);
  return (
    <TextField
      label={label}
      value={value}
      disabled={disabled}
      error={!!error}
      helperText={
        error || [helperText, identifierGuidance].filter(Boolean).join(" ")
      }
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
