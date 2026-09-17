import { useEffect, useRef, useState } from "react";
import { TextField } from "@mui/material";
export default function JsonField({
  label,
  value,
  onChange,
  onValidity,
  disabled = false,
  rows = 4,
}: {
  label: string;
  value: unknown;
  onChange: (value: unknown) => void;
  onValidity: (valid: boolean) => void;
  disabled?: boolean;
  rows?: number;
}) {
  const validity = useRef(onValidity);
  validity.current = onValidity;
  useEffect(() => () => validity.current(true), []);
  const [text, setText] = useState(JSON.stringify(value, null, 2) ?? "");
  const [error, setError] = useState("");
  const encoded = JSON.stringify(value);
  useEffect(() => {
    setText(encoded ? JSON.stringify(JSON.parse(encoded), null, 2) : "");
    setError("");
  }, [encoded]);
  return (
    <TextField
      label={label}
      multiline
      minRows={rows}
      maxRows={18}
      value={text}
      disabled={disabled}
      error={!!error}
      helperText={error || "JSON"}
      onChange={(e) => {
        setText(e.target.value);
        try {
          const v = e.target.value.trim() ? JSON.parse(e.target.value) : null;
          onChange(v);
          setError("");
          onValidity(true);
        } catch {
          setError("Enter valid JSON before saving");
          onValidity(false);
        }
      }}
      slotProps={{
        input: {
          style: { fontFamily: "JetBrains Mono, monospace", fontSize: 12 },
        },
      }}
    />
  );
}
