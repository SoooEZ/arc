import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "../../api/errors";

/**
 * Whether a click on a library card inserts: the second and later clicks of a
 * double or triple click (event.detail above 1) do not, so a click sequence
 * inserts once; keyboard activation (detail 0) and a first click do (lesson
 * F30). Cards that insert at once follow it as reading cards do: a double
 * click inserted a Switch module twice (a duplicate node ID) and nested
 * $ROUND in itself.
 */
export function insertsOnClick(event: { detail: number }): boolean {
  return event.detail <= 1;
}

interface InsertionState {
  /** Key of the library card whose insertion is loading, or "". */
  busy: string;
  error: string;
}

const idle: InsertionState = { busy: "", error: "" };

/**
 * One pending insertion from a studio library card. A new choice aborts the
 * previous read, so a late response cannot insert after a newer choice, and
 * `onCardClick` ignores the repeated clicks of a double or triple click, so a
 * click sequence inserts once however fast the read answers (lesson F30).
 * Unmounting or `cancel` aborts the read too. Only the current choice reports
 * its busy card or its error.
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
  /** A card's click handler; see insertsOnClick. */
  const onCardClick = (
    event: { detail: number },
    key: string,
    insert: (signal: AbortSignal) => Promise<void>,
  ) => {
    if (insertsOnClick(event)) void run(key, insert);
  };
  const dismissError = () => setState(idle);
  return {
    busy: state.busy,
    error: state.error,
    onCardClick,
    cancel,
    dismissError,
  };
}
