import { TextField } from "@mui/material";
import { isResourceId, resourceIdGuidance } from "../domain/resourceIds";
import { useRefusedEdit } from "../hooks/useRefusedEdit";

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
  const edit = useRefusedEdit(value);
  return (
    <TextField
      label={label}
      value={value}
      disabled={disabled}
      placeholder={placeholder}
      error={edit.refused || (!!value && !isResourceId(value))}
      onChange={(event) => {
        const next = event.target.value;
        if (next !== "" && !isResourceId(next)) {
          edit.refuse();
          return;
        }
        edit.clear();
        onChange(next);
      }}
      onPaste={edit.onPaste}
      helperText={`${description} ${resourceIdGuidance}`}
      // A floating label keeps an example placeholder from overlapping it.
      slotProps={placeholder ? { inputLabel: { shrink: true } } : undefined}
    />
  );
}
