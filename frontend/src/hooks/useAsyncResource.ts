import { useEffect, useRef, useState } from "react";
import { errorMessage } from "../api/errors";
interface Resource<T> {
  data: T;
  error: string;
  loading: boolean;
}
/** Cancel stale reads, including servers that finish after the selected resource changes. */
export function useAsyncResource<T>(
  key: string,
  load: (signal: AbortSignal) => Promise<T>,
  initial: T,
  delay = 0,
  enabled = true,
): Resource<T> {
  const latest = useRef(load);
  latest.current = load;
  const [state, setState] = useState<
    Resource<T> & { key: string; enabled: boolean }
  >({ key, enabled, data: initial, error: "", loading: enabled });
  useEffect(() => {
    const controller = new AbortController();
    setState({ key, enabled, data: initial, error: "", loading: enabled });
    if (!enabled) return;
    const timer = setTimeout(() => {
      latest
        .current(controller.signal)
        .then((data) => {
          if (!controller.signal.aborted)
            setState({ key, enabled, data, error: "", loading: false });
        })
        .catch((error) => {
          if (!controller.signal.aborted)
            setState({
              key,
              enabled,
              data: initial,
              error: errorMessage(error),
              loading: false,
            });
        });
    }, delay);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
    // key is the resource identity; consumers may supply inline loaders and defaults.
  }, [key, delay, enabled]);
  return state.key === key && state.enabled === enabled
    ? state
    : { data: initial, error: "", loading: enabled };
}
