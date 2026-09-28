import { Alert } from "@mui/material";
import type { Execution } from "../../types";

/**
 * What the response says about its trace: disabled by the request, or cut at
 * the size limit. Both execution surfaces show the same wording in the same
 * order; the editor adds that its graph highlights follow the recorded steps.
 */
export default function TraceNotices({
  result,
  graphHighlights = false,
}: {
  result: Execution;
  graphHighlights?: boolean;
}) {
  return (
    <>
      {result.traceEnabled === false && (
        <Alert severity="info">
          Trace disabled. The result includes all executed calculations.
        </Alert>
      )}
      {result.traceTruncated && (
        <Alert severity="warning">
          Trace size limit reached. Showing the first {result.trace.length} of{" "}
          {result.executedSteps} executed steps. The final result is complete
          {graphHighlights
            ? "; graph highlights show only the recorded steps."
            : "."}
        </Alert>
      )}
    </>
  );
}
