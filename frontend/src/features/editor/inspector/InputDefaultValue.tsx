import { MenuItem, TextField } from "@mui/material";
import type { Input } from "../../../types";
import JsonField from "../../../components/JsonField";
import NumericDefaultField from "./NumericDefaultField";

export default function InputDefaultValue({
  input,
  disabled,
  onChange,
  onValidity,
}: {
  input: Input;
  disabled: boolean;
  onChange: (value: unknown) => void;
  onValidity: (valid: boolean) => void;
}) {
  if (input.type === "ARRAY" || input.type === "OBJECT")
    return (
      <JsonField
        label="Default JSON (optional)"
        onValidity={onValidity}
        rows={2}
        value={input.defaultValue}
        disabled={disabled}
        onChange={onChange}
      />
    );
  if (input.type === "BOOLEAN")
    return (
      <TextField
        label="Default value"
        select
        disabled={disabled}
        value={input.defaultValue == null ? "" : String(input.defaultValue)}
        onChange={(event) =>
          onChange(
            event.target.value === "" ? null : event.target.value === "true",
          )
        }
      >
        <MenuItem value="">No default</MenuItem>
        <MenuItem value="true">true</MenuItem>
        <MenuItem value="false">false</MenuItem>
      </TextField>
    );
  if (input.type === "NUMBER")
    return (
      <NumericDefaultField
        value={input.defaultValue}
        disabled={disabled}
        onChange={onChange}
        onValidity={onValidity}
      />
    );
  return (
    <TextField
      label="Default value (optional)"
      value={input.defaultValue ?? ""}
      disabled={disabled}
      onChange={(event) => {
        const value = event.target.value;
        onChange(value === "" ? null : value);
      }}
    />
  );
}
