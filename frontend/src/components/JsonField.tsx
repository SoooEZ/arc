import { useEffect, useRef, useState } from "react";
import { TextField } from "@mui/material";
import { parseJson, stringifyJson } from "../domain/json";

/** Indented JSON for a value; an undefined value (no default at all) is an empty buffer. */
const jsonText = (value: unknown) => stringifyJson(value, 2) ?? "";

/** Values are the same when they serialize identically, including DecimalNumber digits. */
const sameJson = (left: unknown, right: unknown) =>
  Object.is(left, right) || stringifyJson(left) === stringifyJson(right);

export default function JsonField({
  label,
  value,
  onChange,
  onValidity,
  check,
  disabled = false,
  rows = 4,
}: {
  label: string;
  value: unknown;
  onChange: (value: unknown) => void;
  onValidity: (valid: boolean) => void;
  /**
   * Why a parsed document is still not acceptable, or null. A problem shows as
   * the field error and keeps the value out of `onChange`, like invalid JSON.
   */
  check?: (value: unknown) => string | null;
  disabled?: boolean;
  rows?: number;
}) {
  const validity = useRef(onValidity);
  validity.current = onValidity;
  useEffect(() => () => validity.current(true), []);
  const [text, setText] = useState(() => jsonText(value));
  const [error, setError] = useState("");
  // The value the text represents: the last one typed here or received from outside.
  const acceptedValue = useRef(value);
  useEffect(() => {
    // Typing echoes its own value back through the draft; rewriting the text then
    // would move the caret. Only a different value from outside replaces the buffer.
    if (sameJson(value, acceptedValue.current)) return;
    acceptedValue.current = value;
    setText(jsonText(value));
    setError("");
    validity.current(true);
  }, [value]);
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
        const raw = e.target.value;
        setText(raw);
        let parsed: unknown;
        try {
          parsed = raw.trim() ? parseJson(raw) : null;
        } catch {
          setError("Enter valid JSON before saving");
          onValidity(false);
          return;
        }
        const problem = check?.(parsed) ?? null;
        if (problem) {
          setError(problem);
          onValidity(false);
          return;
        }
        acceptedValue.current = parsed;
        onChange(parsed);
        setError("");
        onValidity(true);
      }}
      slotProps={{
        input: {
          className: "code-text",
          style: { fontFamily: "JetBrains Mono, monospace", fontSize: 12 },
        },
      }}
    />
  );
}
