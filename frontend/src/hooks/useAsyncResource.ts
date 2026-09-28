import { useEffect, useRef, useState } from "react";
import { errorMessage } from "../api/errors";
interface Resource<T> {
  data: T;
  error: string;
  loading: boolean;
}
interface ResourceOptions {
  /**
   * While a new key loads, keep returning the previous key's data (with
   * `loading` true) instead of `initial`, so lists do not blank and remount.
   */
  keepPrevious?: boolean;
}
/** Cancel stale reads, including servers that finish after the selected resource changes. */
export function useAsyncResource<T>(
  key: string,
  load: (signal: AbortSignal) => Promise<T>,
  initial: T,
  delay = 0,
  enabled = true,
  { keepPrevious = false }: ResourceOptions = {},
): Resource<T> {
  const latest = useRef(load);
  latest.current = load;
  const [state, setState] = useState<
    Resource<T> & { key: string; enabled: boolean }
  >({ key, enabled, data: initial, error: "", loading: enabled });
  const keepData = keepPrevious && enabled;
  useEffect(() => {
    const controller = new AbortController();
    setState((previous) => ({
      key,
      enabled,
      data: keepData ? previous.data : initial,
      error: "",
      loading: enabled,
    }));
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
  }, [key, delay, enabled, keepData]);
  if (state.key === key && state.enabled === enabled) return state;
  return {
    data: keepData ? state.data : initial,
    error: "",
    loading: enabled,
  };
}
