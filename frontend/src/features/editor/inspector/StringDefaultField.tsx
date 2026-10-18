import { TextField } from "@mui/material";
import {
  defaultText,
  parseStringDefault,
  sameStringDefault,
} from "../../../domain/inputDefaults";
import { useParsedTextBuffer } from "../../../hooks/useParsedTextBuffer";

/**
 * A STRING default. Text the server would refuse stays in the field with the
 * server's reason, as a number or JSON default does (parseStringDefault).
 */
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
    parse: parseStringDefault,
    same: sameStringDefault,
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
