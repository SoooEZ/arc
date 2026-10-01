import { MenuItem, TextField } from "@mui/material";
import { literalText, quoteText } from "../../domain/expressions";
import { trimAsServer } from "../../domain/serverText";
import {
  constantTextError,
  type ConstantType,
} from "../../domain/valueBinding";

/** Edits a typed value while preserving the expression stored in the graph. */
export default function ConstantValueField({
  label,
  type,
  value,
  disabled,
  helperText,
  onChange,
}: {
  label: string;
  type: ConstantType;
  value?: string;
  disabled: boolean;
  helperText?: string;
  onChange: (value: string | undefined) => void;
}) {
  const stored = value ?? "";
  if (type === "NULL") {
    return (
      <TextField
        label={label}
        value="null"
        disabled
        helperText="Returns an explicit null value"
      />
    );
  }
  if (type === "BOOLEAN") {
    return (
      <TextField
        select
        label={label}
        value={trimAsServer(stored).toLowerCase() || "false"}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        helperText={helperText}
      >
        <MenuItem value="true">true</MenuItem>
        <MenuItem value="false">false</MenuItem>
      </TextField>
    );
  }
  const error = constantTextError(type, stored);
  if (type === "STRING") {
    return (
      <TextField
        label={label}
        value={literalText(trimAsServer(stored)) ?? stored}
        disabled={disabled}
        error={!!error}
        onChange={(event) => onChange(quoteText(event.target.value))}
        helperText={error ?? "Text value · no quotation marks needed"}
      />
    );
  }
  if (type === "NUMBER")
    return (
      <TextField
        label={label}
        // A number input shows nothing for padded text; the server trims it too.
        value={trimAsServer(stored)}
        disabled={disabled}
        type="number"
        error={!!error}
        onChange={(event) => onChange(event.target.value || undefined)}
        helperText={error ?? (helperText || "number")}
      />
    );
  return (
    <TextField
      label={label}
      value={stored}
      disabled={disabled}
      multiline
      error={!!error}
      onChange={(event) => onChange(event.target.value || undefined)}
      helperText={
        error ?? (helperText || "ARC array literal, for example [1, 2, 3]")
      }
    />
  );
}
