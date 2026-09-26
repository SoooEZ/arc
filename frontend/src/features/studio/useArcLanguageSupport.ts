import { useEffect, type RefObject } from "react";
import { monaco } from "./arcLanguage";
import type { Definition, FunctionEntry } from "../../types";
import { modules } from "./snippets";

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

/** Providers belong to one model; nested rule dialogs do not leak suggestions into each other. */
export function useArcLanguageSupport(
  editor: RefObject<monaco.editor.IStandaloneCodeEditor | null>,
  functions: FunctionEntry[],
  definition: Definition | string[],
  includeModules = true,
) {
  useEffect(() => {
    const completions = monaco.languages.registerCompletionItemProvider("arc", {
      triggerCharacters: ["$"],
      provideCompletionItems: (model, position) => {
        if (model !== editor.current?.getModel()) return { suggestions: [] };
        if (isStringOrComment(model, position)) return { suggestions: [] };
        const w = completionWord(model, position);
        const functionOnly = w.word.startsWith("$");
        const functionPrefix = functionOnly ? w.word.toUpperCase() : "$";
        let variables: string[] = [];
        if (!functionOnly)
          variables = Array.isArray(definition)
            ? definition
            : [
                ...definition.inputs.map((input) => input.name),
                ...definition.nodes.flatMap((node) =>
                  node.output ? [node.output] : [],
                ),
              ];
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: w.startColumn,
          endColumn: w.endColumn,
        };
        return {
          // Monaco's fuzzy ranking treats '$RO' as a close match for '$OR'.
          // Recompute the actual namespace prefix as the user types instead.
          incomplete: functionOnly,
          suggestions: [
            ...functions
              .filter((f) => f.supported && f.name.startsWith(functionPrefix))
              .map((f) => ({
                label: f.name,
                kind: monaco.languages.CompletionItemKind.Function,
                detail: f.signature,
                documentation: f.description,
                insertText: f.snippet,
                insertTextRules:
                  monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                range,
              })),
            ...(includeModules && !functionOnly ? modules : []).map((m) => ({
              label: m.name,
              kind: monaco.languages.CompletionItemKind.Snippet,
              insertText: m.snippet,
              insertTextRules:
                monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              range,
            })),
            ...variables.map((name) => ({
              label: name,
              kind: monaco.languages.CompletionItemKind.Variable,
              insertText: name,
              range,
            })),
          ],
        };
      },
    });
    const hover = monaco.languages.registerHoverProvider("arc", {
      provideHover: (model, position) => {
        if (model !== editor.current?.getModel()) return null;
        if (isStringOrComment(model, position)) return null;
        const w = model.getWordAtPosition(position);
        if (!w) return null;
        const explicitFunction = w.word.startsWith("$");
        const afterWord = model
          .getLineContent(position.lineNumber)
          .slice(w.endColumn - 1);
        // Bare names still execute for compatibility, but a variable named
        // ROUND must not display function help unless it is actually called.
        if (!explicitFunction && !/^\s*\(/.test(afterWord)) return null;
        const name = explicitFunction ? w.word : "$" + w.word;
        const f = functions.find((f) => f.name === name.toUpperCase());
        return f
          ? {
              contents: [
                { value: "```arc\n" + f.signature + "\n```" },
                { value: f.description },
              ],
            }
          : null;
      },
    });
    return () => {
      completions.dispose();
      hover.dispose();
    };
  }, [editor, functions, definition, includeModules]);
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
