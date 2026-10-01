import { TextField } from "@mui/material";
import { inputDefaultProblem } from "../../../domain/inputDefaults";
import type { ParsedText } from "../../../hooks/useParsedTextBuffer";
import { useParsedTextBuffer } from "../../../hooks/useParsedTextBuffer";

const defaultText = (value: unknown) => (value == null ? "" : String(value));
const sameText = (left: unknown, right: unknown) => left === right;

/**
 * Text the server would refuse as a STRING default (over 2,000 characters, a
 * NUL, an unpaired surrogate) stays in the field with the server's reason, as
 * a number or JSON default does; it reached the draft, and the save failed.
 */
function parseTextDefault(raw: string): ParsedText<string | null> {
  if (raw === "") return { valid: true, value: null };
  const problem = inputDefaultProblem("STRING", raw);
  return problem
    ? { valid: false, error: problem }
    : { valid: true, value: raw };
}

export default function StringDefaultField({
  value,
  disabled,
  onChange,
  onValidity,
}: {
  value: unknown;
  disabled: boolean;
  onChange: (value: string | null) => void;
  onValidity: (valid: boolean) => void;
}) {
  const buffer = useParsedTextBuffer<unknown, string | null>({
    value,
    format: defaultText,
    parse: parseTextDefault,
    same: sameText,
    onChange,
    onValidity,
  });
  return (
    <TextField
      label="Default value (optional)"
      value={buffer.text}
      disabled={disabled}
      error={!!buffer.error}
      helperText={buffer.error}
      onChange={(event) => buffer.change(event.target.value)}
    />
  );
}
