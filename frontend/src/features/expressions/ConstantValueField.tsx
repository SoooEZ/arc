import { MenuItem, TextField } from "@mui/material";
import type { InputType } from "../../types";
import { literalText, quoteText } from "../../domain/expressions";

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
  type: InputType | "NULL";
  value?: string;
  disabled: boolean;
  helperText?: string;
  onChange: (value: string | undefined) => void;
}) {
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
        value={value?.trim().toLowerCase() || "false"}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        helperText={helperText}
      >
        <MenuItem value="true">true</MenuItem>
        <MenuItem value="false">false</MenuItem>
      </TextField>
    );
  }
  const literal = literalText((value ?? "").trim());
  const text = type === "STRING" && literal !== null ? literal : (value ?? "");
  const hint =
    type === "STRING"
      ? "Text value · no quotation marks needed"
      : helperText ||
        (type === "ARRAY"
          ? "ARC array literal, for example [1, 2, 3]"
          : type.toLowerCase());
  return (
    <TextField
      label={label}
      value={text}
      disabled={disabled}
      multiline={type === "ARRAY" || type === "OBJECT"}
      type={type === "NUMBER" ? "number" : "text"}
      onChange={(event) =>
        onChange(
          type === "STRING"
            ? quoteText(event.target.value)
            : event.target.value || undefined,
        )
      }
      helperText={hint}
    />
  );
}
