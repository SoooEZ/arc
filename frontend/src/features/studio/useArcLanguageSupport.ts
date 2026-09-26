import { useEffect, type RefObject } from "react";
import { monaco } from "./arcLanguage";
import type { Definition, FunctionEntry } from "../../types";
import { modules } from "./snippets";
import { inputVariables, type VariableOption } from "../../domain/graph";
import { expressionSymbols } from "../../domain/expressionSymbols";

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
  editorModel: monaco.editor.ITextModel | null,
  functions: FunctionEntry[],
  definition: Definition | VariableOption[],
  includeModules = true,
) {
  useEffect(() => {
    // Providers must register after Monaco attaches the model. An initial token
    // request before onMount otherwise returns null and may never be retried.
    if (!editorModel || editorModel.isDisposed()) return;
    const variables: VariableOption[] = Array.isArray(definition)
      ? definition
      : [
          ...inputVariables(definition),
          ...definition.nodes.flatMap((node): VariableOption[] =>
            node.output
              ? [{ name: node.output, type: "RESULT", label: node.label }]
              : [],
          ),
        ];
    const colors = monaco.languages.registerDocumentSemanticTokensProvider(
      "arc",
      {
        getLegend: () => ({
          tokenTypes: ["function", "parameter", "variable"],
          tokenModifiers: ["local"],
        }),
        provideDocumentSemanticTokens: (model) => {
          if (model !== editor.current?.getModel()) return null;
          const data: number[] = [];
          let previousLine = 0;
          let previousColumn = 0;
          for (const symbol of expressionSymbols(
            model.getValue(),
            variables,
            !Array.isArray(definition),
          )) {
            const position = model.getPositionAt(symbol.offset);
            const line = position.lineNumber - 1;
            const column = position.column - 1;
            data.push(
              line - previousLine,
              line === previousLine ? column - previousColumn : column,
              symbol.length,
              symbol.kind === "function"
                ? 0
                : symbol.kind === "parameter"
                  ? 1
                  : 2,
              symbol.kind === "variable.local" ? 1 : 0,
            );
            previousLine = line;
            previousColumn = column;
          }
          return { data: new Uint32Array(data) };
        },
        releaseDocumentSemanticTokens: () => {},
      },
    );
    const completions = monaco.languages.registerCompletionItemProvider("arc", {
      triggerCharacters: ["$"],
      provideCompletionItems: (model, position) => {
        if (model !== editor.current?.getModel()) return { suggestions: [] };
        if (isStringOrComment(model, position)) return { suggestions: [] };
        const w = completionWord(model, position);
        const functionOnly = w.word.startsWith("$");
        const functionPrefix = functionOnly ? w.word.toUpperCase() : "$";
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
            ...(functionOnly ? [] : variables).map((variable) => ({
              label: variable.name,
              kind: monaco.languages.CompletionItemKind.Variable,
              insertText: variable.name,
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
        // A variable named ROUND must not display function help unless called.
        if (!explicitFunction && !/^\s*\(/.test(afterWord)) return null;
        const name = explicitFunction ? w.word : "$" + w.word;
        const f = functions.find((f) => f.name === name.toUpperCase());
        return f
          ? {
              contents: [
                ...(!explicitFunction
                  ? [
                      {
                        value: `Function calls require a $ prefix. Use \`${f.name}(...)\`.`,
                      },
                    ]
                  : []),
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
      colors.dispose();
    };
  }, [editor, editorModel, functions, definition, includeModules]);
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
