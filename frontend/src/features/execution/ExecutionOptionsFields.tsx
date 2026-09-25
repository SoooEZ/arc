import {
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  TextField,
} from "@mui/material";

export default function ExecutionOptionsFields({
  trace,
  timeoutMs,
  onTrace,
  onTimeout,
}: {
  trace: boolean;
  timeoutMs: number;
  onTrace: (value: boolean) => void;
  onTimeout: (value: number) => void;
}) {
  return (
    <Stack
      direction="row"
      useFlexGap
      spacing={1}
      sx={{ my: 1, alignItems: "center", flexWrap: "wrap" }}
    >
      <FormControlLabel
        control={
          <Switch
            size="small"
            checked={trace}
            onChange={(_, checked) => onTrace(checked)}
          />
        }
        label="Include execution trace"
      />
      <TextField
        select
        size="small"
        label="Execution timeout"
        value={timeoutMs}
        onChange={(event) => onTimeout(Number(event.target.value))}
        sx={{ minWidth: 155 }}
      >
        {[1000, 5000, 10000, 30000].map((value) => (
          <MenuItem key={value} value={value}>
            {value / 1000} seconds
          </MenuItem>
        ))}
      </TextField>
    </Stack>
  );
}
