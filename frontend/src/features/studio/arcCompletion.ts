import { monaco } from "./arcLanguage";

/** Trigger characters also fire inside strings, independently of quickSuggestions. */
export function isStringOrComment(
  model: monaco.editor.ITextModel,
  position: monaco.Position,
) {
  const tokens = monaco.editor.tokenize(
    model.getLineContent(position.lineNumber),
    "arc",
  )[0];
  let token: monaco.Token | undefined;
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
