import { TextField } from "@mui/material";
import { parseJson, stringifyJson } from "../domain/json";
import {
  useParsedTextBuffer,
  type ParsedText,
} from "../hooks/useParsedTextBuffer";

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
  // Empty text is no value; invalid JSON and a checked problem stay in the field.
  const parse = (raw: string): ParsedText<unknown> => {
    let parsed: unknown;
    try {
      parsed = raw.trim() ? parseJson(raw) : null;
    } catch {
      return { valid: false, error: "Enter valid JSON before saving" };
    }
    const problem = check?.(parsed) ?? null;
    return problem
      ? { valid: false, error: problem }
      : { valid: true, value: parsed };
  };
  const buffer = useParsedTextBuffer<unknown, unknown>({
    value,
    format: jsonText,
    parse,
    same: sameJson,
    onChange,
    onValidity,
  });
  return (
    <TextField
      label={label}
      multiline
      minRows={rows}
      maxRows={18}
      value={buffer.text}
      disabled={disabled}
      error={!!buffer.error}
      helperText={buffer.error || "JSON"}
      onChange={(e) => buffer.change(e.target.value)}
      slotProps={{ input: { className: "code-text json-field-input" } }}
    />
  );
}
