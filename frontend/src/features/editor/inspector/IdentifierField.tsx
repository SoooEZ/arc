import { useState } from "react";
import { TextField } from "@mui/material";
import {
  acceptsIdentifierEdit,
  identifierError,
  identifierGuidance,
} from "../../../domain/identifiers";

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
  const error = rejectedEdit
    ? identifierGuidance
    : optional && value === ""
      ? null
      : identifierError(value);
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
        const accepted = acceptsIdentifierEdit(name);
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
