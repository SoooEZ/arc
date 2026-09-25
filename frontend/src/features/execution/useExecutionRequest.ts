import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, errorMessage, type GraphProblem } from "../../api/errors";
import type { Execution } from "../../types";

interface ExecutionState {
  key: string;
  running: boolean;
  result: Execution | null;
  error: string;
  problem: GraphProblem | null;
  requestDurationMs: number | null;
}
const idle = (key: string): ExecutionState => ({
  key,
  running: false,
  result: null,
  error: "",
  problem: null,
  requestDurationMs: null,
});

/** An execution belongs to exactly one graph/version and input buffer. */
export function useExecutionRequest(key: string) {
  const [state, setState] = useState(() => idle(key));
  const currentKey = useRef(key);
  currentKey.current = key;
  const active = useRef<AbortController | null>(null);
  const cancel = useCallback(() => {
    active.current?.abort();
    active.current = null;
  }, []);
  useEffect(() => {
    cancel();
    setState(idle(key));
    return cancel;
  }, [key, cancel]);

  const run = async (execute: (signal: AbortSignal) => Promise<Execution>) => {
    cancel();
    const controller = new AbortController();
    active.current = controller;
    setState({ ...idle(key), running: true });
    const isCurrent = () =>
      active.current === controller && currentKey.current === key;
    const started = performance.now();
    try {
      const result = await execute(controller.signal);
      if (isCurrent())
        setState({
          ...idle(key),
          result,
          requestDurationMs: performance.now() - started,
        });
    } catch (failure) {
      if (isCurrent())
        setState({
          ...idle(key),
          error: errorMessage(failure),
          requestDurationMs: performance.now() - started,
          problem:
            failure instanceof ApiError
              ? { message: failure.message, locations: failure.locations }
              : null,
        });
    } finally {
      if (active.current === controller) active.current = null;
    }
  };
  const clear = () => {
    cancel();
    setState(idle(key));
  };
  return { ...(state.key === key ? state : idle(key)), run, clear };
}
