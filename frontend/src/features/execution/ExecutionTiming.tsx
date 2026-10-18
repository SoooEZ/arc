import { Stack, Tooltip, Typography } from "@mui/material";
import type { Execution } from "../../types";

const milliseconds = (micros: number) => (micros / 1000).toFixed(2);

/**
 * How long a run took: the browser round trip, the server's total and its
 * preparation and execution. `compact` shows the round trip alone, as "Ran in
 * 32 ms", with the breakdown in its tooltip.
 */
export default function ExecutionTiming({
  result,
  requestDurationMs,
  compact = false,
}: {
  result: Execution;
  requestDurationMs: number | null;
  compact?: boolean;
}) {
  const execution = milliseconds(
    result.timing?.executionMicros ?? result.durationMicros,
  );
  if (compact) {
    const parts = [
      requestDurationMs !== null &&
        `Request ${requestDurationMs.toFixed(2)} ms`,
      result.timing && `Server ${milliseconds(result.timing.totalMicros)} ms`,
      result.timing &&
        `Preparation ${milliseconds(result.timing.preparationMicros)} ms`,
      `Execution ${execution} ms`,
    ].filter(Boolean);
    const shown =
      requestDurationMs !== null
        ? Math.max(1, Math.round(requestDurationMs))
        : execution;
    return (
      <Tooltip title={parts.join(" · ")}>
        <Typography
          variant="caption"
          className="execution-timing-compact"
          data-testid="execution-timing"
        >
          Ran in {shown} ms
        </Typography>
      </Tooltip>
    );
  }
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
            Server {milliseconds(result.timing.totalMicros)} ms
          </Typography>
          <Typography variant="caption">
            Preparation {milliseconds(result.timing.preparationMicros)} ms
          </Typography>
        </>
      )}
      <Typography variant="caption">Execution {execution} ms</Typography>
    </Stack>
  );
}
