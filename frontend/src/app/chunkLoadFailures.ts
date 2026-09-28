import { useSyncExternalStore } from "react";

let failed = false;
const listeners = new Set<() => void>();

/**
 * Vite dispatches vite:preloadError when a lazy chunk or its stylesheet cannot
 * be downloaded, typically because a redeploy removed the old hashed files.
 * The failure itself stays with the LazyBoundary that requested the chunk (the
 * event is not cancelled); the workspace only asks the user to save and reload.
 * Call this before rendering so failures during the first render are recorded.
 */
export function watchChunkLoadFailures(target: Window): void {
  target.addEventListener("vite:preloadError", () => {
    if (failed) return;
    failed = true;
    for (const listener of listeners) listener();
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Whether any lazy chunk failed to download since the page loaded. */
export function useChunkLoadFailed(): boolean {
  return useSyncExternalStore(subscribe, () => failed);
}
