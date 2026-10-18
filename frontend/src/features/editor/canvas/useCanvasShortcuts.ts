import { useEffect, type RefObject } from "react";

/** Text fields, selects and code editors keep their own keys, Undo included. */
const editableTarget =
  'input, textarea, select, [contenteditable=""], [contenteditable="true"], .monaco-editor';

/**
 * The canvas's keyboard commands: ⌘/Ctrl Z undoes, ⌘/Ctrl Shift Z or Ctrl Y
 * redoes, and Delete or Backspace removes the selection. They apply while the
 * focus is on the canvas (a card or a connection) or on nothing, never while it
 * is in a field, the inspector or a dialog. Deleting with the focus on nothing
 * removes only a selected connection: a card stays selected after a click on
 * the pane, and must be focused to be deleted by key.
 */
export function useCanvasShortcuts({
  workspace,
  enabled,
  undo,
  redo,
  deleteSelection,
}: {
  /** The canvas region whose focused elements the keys act on. */
  workspace: RefObject<HTMLElement | null>;
  /** False for a published version, which offers no editing. */
  enabled: boolean;
  undo: () => void;
  redo: () => void;
  /** Deletes the selected connection, or the selected card when `cards`; reports whether it deleted. */
  deleteSelection: (cards: boolean) => boolean;
}) {
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (event.defaultPrevented || event.isComposing) return;
      if (!(target instanceof Element) || target.closest(editableTarget))
        return;
      const onCanvas = !!workspace.current?.contains(target);
      if (!onCanvas && target !== target.ownerDocument.body) return;
      const command = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (command && key === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      } else if (command && key === "y") {
        event.preventDefault();
        redo();
      } else if (
        !command &&
        !event.altKey &&
        (event.key === "Delete" || event.key === "Backspace") &&
        deleteSelection(onCanvas)
      )
        event.preventDefault();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [workspace, enabled, undo, redo, deleteSelection]);
}
