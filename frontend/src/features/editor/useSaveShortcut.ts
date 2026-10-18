import { useEffect, useRef } from "react";

/**
 * ⌘/Ctrl S runs `save` wherever the focus is in the editor, and never opens
 * the browser's Save page dialog there. Code studio's editor handles the key
 * itself first. A dialog keeps it: its changes join the draft only when
 * applied, so saving underneath it would leave them out.
 */
export function useSaveShortcut(enabled: boolean, save: () => void) {
  const latest = useRef(save);
  latest.current = save;
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.shiftKey) return;
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "s")
        return;
      event.preventDefault();
      const target = event.target;
      if (target instanceof Element && target.closest('[role="dialog"]'))
        return;
      latest.current();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}
