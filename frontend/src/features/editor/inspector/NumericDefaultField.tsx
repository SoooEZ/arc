import { TextField } from "@mui/material";
import type { DecimalNumber } from "../../../domain/json";
import {
  parseNumericDefault,
  sameNumericDefault,
} from "../../../domain/numericDefaults";
import { useParsedTextBuffer } from "../../../hooks/useParsedTextBuffer";

const defaultText = (value: unknown) => (value == null ? "" : String(value));

export default function NumericDefaultField({
  value,
  disabled,
  onChange,
  onValidity,
}: {
  value: unknown;
  disabled: boolean;
  onChange: (value: number | DecimalNumber | null) => void;
  onValidity: (valid: boolean) => void;
}) {
  const buffer = useParsedTextBuffer<unknown, number | DecimalNumber | null>({
    value,
    format: defaultText,
    parse: parseNumericDefault,
    same: sameNumericDefault,
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
      slotProps={{ htmlInput: { inputMode: "decimal" } }}
      onChange={(event) => buffer.change(event.target.value)}
    />
  );
}
