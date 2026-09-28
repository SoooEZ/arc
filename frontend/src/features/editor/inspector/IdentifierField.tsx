import { useState } from "react";
import { TextField } from "@mui/material";
import {
  acceptsIdentifierEdit,
  identifierError,
  identifierGuidance,
} from "../../../domain/identifiers";

/** A refused edit explains the rule; an empty optional name is valid. */
function fieldError(
  value: string,
  optional: boolean,
  rejectedEdit: boolean,
): string | null {
  if (rejectedEdit) return identifierGuidance;
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
  const [rejectedEdit, setRejectedEdit] = useState(false);
  const error = fieldError(value, optional, rejectedEdit);
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
        const accepted = acceptsIdentifierEdit(value, name);
        setRejectedEdit(!accepted);
        if (accepted) onChange(name);
      }}
      onPaste={(event) => {
        // Single-line inputs strip tabs/newlines before onChange sees the text.
        if (/[\s$@]/u.test(event.clipboardData.getData("text"))) {
          event.preventDefault();
          setRejectedEdit(true);
        }
      }}
    />
  );
}
