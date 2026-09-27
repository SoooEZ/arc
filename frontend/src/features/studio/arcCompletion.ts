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
