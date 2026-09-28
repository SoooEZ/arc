import { useState } from "react";
import type { ExecutionOptions } from "../../types";
import { defaultExecutionOptions } from "./executionOptions";

/** The complete options an execution request sends. */
export type ExecutionRequestOptions = Required<ExecutionOptions>;

/**
 * The trace and timeout choices of one execution session, starting from the
 * defaults, as one value: the request, the cURL example, the session key and
 * the fields read the same object, so a new option has one place to be added.
 */
export function useExecutionOptions() {
  const [options, setOptions] = useState<ExecutionRequestOptions>(
    defaultExecutionOptions,
  );
  const change = (patch: Partial<ExecutionOptions>) =>
    setOptions((current) => ({ ...current, ...patch }));
  return { options, change };
}
