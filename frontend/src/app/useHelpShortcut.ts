import { useEffect } from "react";

/** Text fields, selects and code editors keep "?" as a character to type. */
const typingTarget =
  'input, textarea, select, [contenteditable=""], [contenteditable="true"], .monaco-editor';

/**
 * "?" (Shift+/ on most layouts) runs `show` wherever no text is being typed
 * and no dialog has the focus. `show` must keep its identity across renders.
 */
export function useHelpShortcut(show: () => void) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      if (event.key !== "?" || event.metaKey || event.ctrlKey || event.altKey)
        return;
      const target = event.target;
      if (
        target instanceof Element &&
        (target.closest(typingTarget) || target.closest('[role="dialog"]'))
      )
        return;
      event.preventDefault();
      show();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [show]);
}
