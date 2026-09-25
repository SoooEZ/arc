import { Stack, Typography } from "@mui/material";
import type { Execution } from "../../types";

export default function ExecutionTiming({
  result,
  requestDurationMs,
}: {
  result: Execution;
  requestDurationMs: number | null;
}) {
  return (
    <Stack
      direction="row"
      spacing={1}
      useFlexGap
      sx={{ my: 1, flexWrap: "wrap" }}
      data-testid="execution-timing"
    >
      {requestDurationMs !== null && (
        <Typography
          variant="caption"
          title="Browser round trip, including response download and JSON parsing"
        >
          Request {requestDurationMs.toFixed(2)} ms
        </Typography>
      )}
      {result.timing && (
        <>
          <Typography
            variant="caption"
            title="Server preparation and execution; excludes HTTP serialization and transfer"
          >
            Server {(result.timing.totalMicros / 1000).toFixed(2)} ms
          </Typography>
          <Typography variant="caption">
            Preparation {(result.timing.preparationMicros / 1000).toFixed(2)} ms
          </Typography>
        </>
      )}
      <Typography variant="caption">
        Execution{" "}
        {(
          (result.timing?.executionMicros ?? result.durationMicros) / 1000
        ).toFixed(2)}{" "}
        ms
      </Typography>
    </Stack>
  );
}
