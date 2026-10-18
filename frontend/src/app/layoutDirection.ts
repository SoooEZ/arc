import { useSyncExternalStore } from "react";
import type { LayoutDirection } from "../domain/nodePorts";

const preferenceKey = "arc.canvas.direction";
const listeners = new Set<() => void>();

function storedDirection(): LayoutDirection {
  try {
    return localStorage.getItem(preferenceKey) === "horizontal"
      ? "horizontal"
      : "vertical";
  } catch {
    return "vertical";
  }
}

let direction: LayoutDirection = storedDirection();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Whether graphs are drawn top to bottom or left to right: the editor canvas,
 * historical versions, referenced rules and library previews alike. A
 * preference of this browser; rules, drafts and their stored positions do not
 * change with it.
 */
export function useLayoutDirection(): LayoutDirection {
  return useSyncExternalStore(subscribe, () => direction);
}

export function setLayoutDirection(next: LayoutDirection): void {
  if (next === direction) return;
  direction = next;
  try {
    localStorage.setItem(preferenceKey, next);
  } catch {
    // Without browser storage the preference lasts until the page reloads.
  }
  for (const listener of listeners) listener();
}
