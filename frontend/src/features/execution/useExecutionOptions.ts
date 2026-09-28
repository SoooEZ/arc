import { useState } from "react";
import { defaultExecutionOptions } from "./executionOptions";

/** The trace and timeout choices of one execution session, starting from the defaults. */
export function useExecutionOptions() {
  const [trace, setTrace] = useState<boolean>(defaultExecutionOptions.trace);
  const [timeoutMs, setTimeoutMs] = useState<number>(
    defaultExecutionOptions.timeoutMs,
  );
  return { trace, setTrace, timeoutMs, setTimeoutMs };
}

export type ExecutionOptionsState = ReturnType<typeof useExecutionOptions>;
