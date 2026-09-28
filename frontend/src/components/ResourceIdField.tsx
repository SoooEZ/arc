import { useState } from "react";
import { TextField } from "@mui/material";
import { isResourceId, resourceIdGuidance } from "../domain/resourceIds";

/**
 * A permanent API ID for a rule or source. Typing or pasting text that breaks
 * the slug policy is refused, so the field always holds its last accepted value.
 */
export default function ResourceIdField({
  label,
  value,
  onChange,
  description,
  disabled = false,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Sentence shown before the shared ID guidance. */
  description: string;
  disabled?: boolean;
  placeholder?: string;
}) {
  // A refusal belongs to the value it left in place; any later value clears it.
  const [refusedAt, setRefusedAt] = useState<string | null>(null);
  const refused = refusedAt === value;
  return (
    <TextField
      label={label}
      value={value}
      disabled={disabled}
      placeholder={placeholder}
      error={refused || (!!value && !isResourceId(value))}
      onChange={(event) => {
        const next = event.target.value;
        if (next !== "" && !isResourceId(next)) {
          setRefusedAt(value);
          return;
        }
        setRefusedAt(null);
        onChange(next);
      }}
      onPaste={(event) => {
        // Native single-line inputs strip tabs/newlines before onChange.
        if (/[\s$@]/u.test(event.clipboardData.getData("text"))) {
          event.preventDefault();
          setRefusedAt(value);
        }
      }}
      helperText={`${description} ${resourceIdGuidance}`}
      // A floating label keeps an example placeholder from overlapping it.
      slotProps={placeholder ? { inputLabel: { shrink: true } } : undefined}
    />
  );
}
