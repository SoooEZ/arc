import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "../../api/errors";

interface InsertionState {
  /** Key of the library card whose insertion is loading, or "". */
  busy: string;
  error: string;
}

const idle: InsertionState = { busy: "", error: "" };

/**
 * One pending insertion from a studio library card. A new choice aborts the
 * previous read, so a double click inserts once and a late response cannot
 * insert after a newer choice. Unmounting or `cancel` aborts it too. Only the
 * current choice reports its busy card or its error.
 */
export function useLibraryInsertion() {
  const [state, setState] = useState(idle);
  const pending = useRef<AbortController | null>(null);
  const cancel = useCallback(() => {
    pending.current?.abort();
    pending.current = null;
    setState((current) => (current === idle ? current : idle));
  }, []);
  useEffect(
    () => () => {
      pending.current?.abort();
      pending.current = null;
    },
    [],
  );

  const run = async (
    key: string,
    insert: (signal: AbortSignal) => Promise<void>,
  ) => {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setState({ busy: key, error: "" });
    let error = "";
    try {
      await insert(controller.signal);
    } catch (failure) {
      if (!controller.signal.aborted) error = errorMessage(failure);
    }
    if (pending.current !== controller) return;
    pending.current = null;
    setState(error ? { busy: "", error } : idle);
  };
  const dismissError = () => setState(idle);
  return { busy: state.busy, error: state.error, run, cancel, dismissError };
}
