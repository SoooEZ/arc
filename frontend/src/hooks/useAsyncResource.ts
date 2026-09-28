import { useEffect, useRef, useState } from "react";
import { ApiError, errorMessage } from "../api/errors";
interface Resource<T> {
  data: T;
  error: string;
  /** The HTTP status behind `error`, when the failure was an API response. */
  status: number | null;
  loading: boolean;
}
interface ResourceOptions {
  /** Milliseconds to wait before reading, so a key that keeps changing reads once. */
  delay?: number;
  /**
   * While a new key loads, keep returning the previous key's data (with
   * `loading` true) instead of `initial`, so lists do not blank and remount.
   */
  keepPrevious?: boolean;
}
type Stored<T> = Resource<T> & { key: string; enabled: boolean };

/** Reads the resource; null when nothing can be read yet (the resource is disabled). */
export type ResourceLoader<T> = (signal: AbortSignal) => Promise<T>;

/**
 * The state to store when a read starts: the pending view of `key`. It returns
 * `previous` untouched when that view is already what the hook renders, so a
 * key change costs one render, not two: for another stored key the render
 * derives the pending view itself, and a fresh mount already stored it.
 */
export function pendingResourceState<T>(
  previous: Stored<T>,
  {
    key,
    enabled,
    keepData,
    initial,
  }: { key: string; enabled: boolean; keepData: boolean; initial: T },
): Stored<T> {
  if (previous.key !== key || previous.enabled !== enabled) return previous;
  const data = keepData ? previous.data : initial;
  const pending =
    previous.loading === enabled &&
    previous.error === "" &&
    previous.status === null &&
    previous.data === data;
  if (pending) return previous;
  return { key, enabled, data, error: "", status: null, loading: enabled };
}

/**
 * Cancel stale reads, including servers that finish after the selected resource
 * changes. The loader carries its own guard: pass null while the resource has no
 * identity yet (no rule selected, no version pinned), and the hook reports
 * `initial` without loading. The key is the resource identity; a changed loader
 * closure alone does not read again.
 */
export function useAsyncResource<T>(
  key: string,
  load: ResourceLoader<T> | null,
  initial: T,
  { delay = 0, keepPrevious = false }: ResourceOptions = {},
): Resource<T> {
  const enabled = load !== null;
  const latest = useRef(load);
  latest.current = load;
  const [state, setState] = useState<Stored<T>>({
    key,
    enabled,
    data: initial,
    error: "",
    status: null,
    loading: enabled,
  });
  const keepData = keepPrevious && enabled;
  useEffect(() => {
    const controller = new AbortController();
    setState((previous) =>
      pendingResourceState(previous, { key, enabled, keepData, initial }),
    );
    if (!enabled) return;
    const timer = setTimeout(() => {
      const read = latest.current;
      if (!read) return;
      read(controller.signal)
        .then((data) => {
          if (!controller.signal.aborted)
            setState({
              key,
              enabled,
              data,
              error: "",
              status: null,
              loading: false,
            });
        })
        .catch((error) => {
          if (!controller.signal.aborted)
            setState({
              key,
              enabled,
              data: initial,
              error: errorMessage(error),
              status: error instanceof ApiError ? (error.status ?? null) : null,
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
    status: null,
    loading: enabled,
  };
}
