import { MenuItem, TextField } from "@mui/material";

/**
 * A version chosen from one loaded history page. A selected version that the
 * page does not hold (an older page is shown, or the list has not loaded) stays
 * listed with the same label as the page's entries, so the closed control never
 * changes its wording while paging.
 */
export default function PagedVersionSelect({
  label,
  value,
  versions,
  disabled = false,
  optionLabel = (version) => `v${version}`,
  onChange,
  onOpen,
}: {
  label: string;
  value: number | null;
  versions: readonly { version: number }[];
  disabled?: boolean;
  optionLabel?: (version: number) => string;
  onChange: (version: number) => void;
  /** Called when the list opens, e.g. to load a history that waits for it. */
  onOpen?: () => void;
}) {
  const listed =
    value !== null && versions.some((item) => item.version === value);
  return (
    <TextField
      select
      label={label}
      value={value ?? ""}
      disabled={disabled}
      slotProps={onOpen ? { select: { onOpen } } : undefined}
      onChange={(event) => onChange(Number(event.target.value))}
    >
      {value !== null && !listed && (
        <MenuItem value={value}>{optionLabel(value)}</MenuItem>
      )}
      {versions.map((item) => (
        <MenuItem key={item.version} value={item.version}>
          {optionLabel(item.version)}
        </MenuItem>
      ))}
    </TextField>
  );
}
