import { useEffect, type RefObject } from "react";
import { monaco } from "./arcLanguage";
import type { Definition, FunctionEntry } from "../../types";
import { modules } from "./snippets";
/** Providers belong to one model; nested rule dialogs do not leak suggestions into each other. */
export function useArcLanguageSupport(
  editor: RefObject<monaco.editor.IStandaloneCodeEditor | null>,
  functions: FunctionEntry[],
  definition: Definition | string[],
  includeModules = true,
) {
  useEffect(() => {
    const completions = monaco.languages.registerCompletionItemProvider("arc", {
      provideCompletionItems: (model, position) => {
        if (model !== editor.current?.getModel()) return { suggestions: [] };
        const w = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: w.startColumn,
          endColumn: w.endColumn,
        };
        return {
          suggestions: [
            ...functions
              .filter((f) => f.supported)
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
            ...(includeModules ? modules : []).map((m) => ({
              label: m.name,
              kind: monaco.languages.CompletionItemKind.Snippet,
              insertText: m.snippet,
              insertTextRules:
                monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              range,
            })),
            ...(Array.isArray(definition)
              ? definition
              : [
                  ...definition.inputs.map((i) => i.name),
                  ...definition.nodes.flatMap((n) =>
                    n.output ? [n.output] : [],
                  ),
                ]
            ).map((name) => ({
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
        const w = model.getWordAtPosition(position);
        const f = functions.find((f) => f.name === w?.word.toUpperCase());
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
