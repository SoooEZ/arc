import {
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  TextField,
} from "@mui/material";
import type { ExecutionOptions } from "../../types";
import { executionTimeoutChoicesMs } from "./executionOptions";
import type { ExecutionRequestOptions } from "./useExecutionOptions";

export default function ExecutionOptionsFields({
  value,
  onChange,
}: {
  value: ExecutionRequestOptions;
  onChange: (patch: Partial<ExecutionOptions>) => void;
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
            checked={value.trace}
            onChange={(_, trace) => onChange({ trace })}
          />
        }
        label="Include execution trace"
      />
      <TextField
        select
        size="small"
        label="Execution timeout"
        value={value.timeoutMs}
        onChange={(event) =>
          onChange({ timeoutMs: Number(event.target.value) })
        }
        sx={{ minWidth: 155 }}
      >
        {executionTimeoutChoicesMs.map((choice) => (
          <MenuItem key={choice} value={choice}>
            {choice / 1000} seconds
          </MenuItem>
        ))}
      </TextField>
    </Stack>
  );
}
