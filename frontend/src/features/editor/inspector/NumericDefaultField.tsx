import { useEffect, useRef, useState } from "react";
import { TextField } from "@mui/material";
import { parseNumericDefault } from "../../../domain/numericDefaults";

export default function NumericDefaultField({
  value,
  disabled,
  onChange,
  onValidity,
}: {
  value: unknown;
  disabled: boolean;
  onChange: (value: number | null) => void;
  onValidity: (valid: boolean) => void;
}) {
  const [text, setText] = useState(value == null ? "" : String(value));
  const [error, setError] = useState("");
  const acceptedValue = useRef(value);
  const validity = useRef(onValidity);
  validity.current = onValidity;
  useEffect(() => () => validity.current(true), []);
  useEffect(() => {
    if (Object.is(value, acceptedValue.current)) return;
    acceptedValue.current = value;
    setText(value == null ? "" : String(value));
    setError("");
    validity.current(true);
  }, [value]);

  return (
    <TextField
      label="Default value (optional)"
      value={text}
      disabled={disabled}
      error={!!error}
      helperText={error}
      slotProps={{ htmlInput: { inputMode: "decimal" } }}
      onChange={(event) => {
        const raw = event.target.value;
        setText(raw);
        const parsed = parseNumericDefault(raw);
        setError(parsed.valid ? "" : parsed.error);
        onValidity(parsed.valid);
        if (parsed.valid) {
          acceptedValue.current = parsed.value;
          onChange(parsed.value);
        }
      }}
    />
  );
}
