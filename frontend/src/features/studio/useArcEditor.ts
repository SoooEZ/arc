import { useCallback, useEffect, useRef, useState } from "react";
import { monaco } from "./arcLanguage";
import type { Diagnostic } from "../../types";

export const arcEditorOptions: monaco.editor.IStandaloneEditorConstructionOptions =
  {
    automaticLayout: true,
    // The native EditContext path drops space/rapid key events in Chromium.
    // Use Monaco's established textarea input path for consistent editing.
    editContext: false,
    tabSize: 2,
    insertSpaces: true,
    minimap: { enabled: false },
    fontFamily: "JetBrains Mono, monospace",
    fontLigatures: false,
    fontSize: 12,
    wordWrap: "on",
    scrollBeyondLastLine: false,
    fixedOverflowWidgets: true,
    "semanticHighlighting.enabled": true,
    suggest: { showWords: false },
  };

const noDiagnostics: Diagnostic[] = [];

/** Own model diagnostics even when Monaco mounts after the response arrives. */
export function useArcEditor(diagnostics = noDiagnostics, owner = "arc") {
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const [model, setModel] = useState<monaco.editor.ITextModel | null>(null);
  const onMount = useCallback(
    (instance: monaco.editor.IStandaloneCodeEditor) => {
      editor.current = instance;
      setModel(instance.getModel());
    },
    [],
  );

  useEffect(() => {
    if (!model || model.isDisposed()) return;
    monaco.editor.setModelMarkers(
      model,
      owner,
      diagnostics.map((diagnostic) => ({
        severity: monaco.MarkerSeverity.Error,
        message: diagnostic.message,
        startLineNumber: diagnostic.line,
        endLineNumber: diagnostic.line,
        startColumn: diagnostic.column,
        endColumn: diagnostic.column + 1,
      })),
    );
    return () => {
      if (!model.isDisposed()) monaco.editor.setModelMarkers(model, owner, []);
    };
  }, [model, diagnostics, owner]);

  useEffect(
    () => () => {
      editor.current = null;
    },
    [],
  );

  const reveal = useCallback((lineNumber: number, column = 1) => {
    editor.current?.revealLineInCenter(lineNumber);
    editor.current?.setPosition({ lineNumber, column });
    editor.current?.focus();
  }, []);

  return { editor, model, onMount, reveal };
}

/**
 * Makes the editor's text `text` through one undoable edit of only the changed
 * span, so the caret and the undo history survive a rewrite into canonical
 * form; `editor.setValue` would reset both. Model edits are allowed while the
 * editor is read-only during a command.
 */
export function adoptSource(
  editor: monaco.editor.IStandaloneCodeEditor,
  text: string,
) {
  const model = editor.getModel();
  if (!model || model.isDisposed()) return;
  const current = model.getValue();
  if (current === text) return;
  const shortest = Math.min(current.length, text.length);
  let prefix = 0;
  while (prefix < shortest && current[prefix] === text[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < shortest - prefix &&
    current[current.length - 1 - suffix] === text[text.length - 1 - suffix]
  )
    suffix++;
  const range = monaco.Range.fromPositions(
    model.getPositionAt(prefix),
    model.getPositionAt(current.length - suffix),
  );
  model.pushStackElement();
  model.pushEditOperations(
    editor.getSelections() ?? [],
    [{ range, text: text.slice(prefix, text.length - suffix) }],
    () => null,
  );
  model.pushStackElement();
}
