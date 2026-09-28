import { monaco } from "./arcLanguage";

/** Trigger characters also fire inside strings, independently of quickSuggestions. */
export function isStringOrComment(
  model: monaco.editor.ITextModel,
  position: monaco.Position,
) {
  // Tokenizing a line alone loses an opening quote from an earlier line.
  // Carry the language's lexical state through the current document prefix.
  const prefix = model.getValueInRange({
    startLineNumber: 1,
    startColumn: 1,
    endLineNumber: position.lineNumber,
    endColumn: model.getLineMaxColumn(position.lineNumber),
  });
  const tokens = monaco.editor.tokenize(prefix, "arc")[position.lineNumber - 1];
  // Hover can target the first character of a continued string line.
  let token = tokens?.[0];
  for (const entry of tokens ?? []) {
    if (entry.offset >= position.column - 1) break;
    token = entry;
  }
  return token?.type.startsWith("string") || token?.type.startsWith("comment");
}

/** Include the namespace marker even before the function name is entered. */
export function completionWord(
  model: monaco.editor.ITextModel,
  position: monaco.Position,
) {
  const before = model
    .getLineContent(position.lineNumber)
    .slice(0, position.column - 1);
  const formula = /@[A-Za-z0-9-]*(?::\d*)?$/.exec(before);
  if (formula)
    return {
      word: formula[0],
      startColumn: formula.index + 1,
      endColumn: position.column,
    };
  const word = model.getWordUntilPosition(position);
  if (
    !word.word.startsWith("$") &&
    model.getLineContent(position.lineNumber)[word.startColumn - 2] === "$"
  )
    return {
      ...word,
      word: "$" + word.word,
      startColumn: word.startColumn - 1,
    };
  return word;
}

export function insertSnippet(
  editor: monaco.editor.IStandaloneCodeEditor | null,
  snippet: string,
  atEnd = false,
) {
  if (!editor) return;
  editor.focus();
  const model = editor.getModel();
  if (atEnd && model)
    editor.setPosition({
      lineNumber: model.getLineCount(),
      column: model.getLineMaxColumn(model.getLineCount()),
    });
  editor
    .getContribution<{ insert: (text: string) => void; dispose: () => void }>(
      "snippetController2",
    )
    ?.insert(snippet);
}

/** The parts of Monaco's suggest controller used here (not in its public typings). */
interface SuggestController extends monaco.editor.IEditorContribution {
  readonly model: {
    /** 0 when no suggestion list is open, 2 when it opened while typing. */
    readonly state: number;
    trigger(options: { auto: boolean; retrigger: boolean }): void;
  };
}

/**
 * Re-query the providers of an open suggestion list after data it shows has
 * changed, such as a variable scope that finished loading. The public
 * `editor.action.triggerSuggest` is disabled while a list is open, and fixed
 * provider registrations no longer refresh it. Formula (`@`) suggestions show
 * no variables, so an open `@` list is left alone.
 */
export function refreshOpenSuggestions(
  editor: monaco.editor.IStandaloneCodeEditor | null,
) {
  const model = editor?.getModel();
  const position = editor?.getPosition();
  const suggest = editor?.getContribution<SuggestController>(
    "editor.contrib.suggestController",
  );
  if (!model || !position || !suggest?.model.state) return;
  if (completionWord(model, position).word.startsWith("@")) return;
  suggest.model.trigger({ auto: suggest.model.state === 2, retrigger: true });
}

/** The model, text version and selection of an editor at one moment. */
export interface EditorState {
  model: monaco.editor.ITextModel | null;
  version: number;
  selection: monaco.Selection | null;
}

/** Captures what an insertion that starts with a read must find unchanged when it completes. */
export function captureEditorState(
  editor: monaco.editor.IStandaloneCodeEditor | null,
): EditorState {
  const model = editor?.getModel() ?? null;
  return {
    model,
    version: model?.getVersionId() ?? -1,
    selection: editor?.getSelection() ?? null,
  };
}

/** Whether `editor` still shows the captured model with the same text version and selection. */
export function unchangedSince(
  editor: monaco.editor.IStandaloneCodeEditor | null,
  state: EditorState,
): boolean {
  const model = editor?.getModel();
  if (!editor || !model || model !== state.model || model.isDisposed())
    return false;
  if (model.getVersionId() !== state.version) return false;
  const selection = editor.getSelection();
  return (
    !!selection &&
    !!state.selection &&
    selection.equalsSelection(state.selection)
  );
}
