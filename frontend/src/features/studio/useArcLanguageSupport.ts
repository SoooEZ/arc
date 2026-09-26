import { useEffect, useMemo, type RefObject } from "react";
import { monaco } from "./arcLanguage";
import type { Definition, FunctionEntry } from "../../types";
import { modules } from "./snippets";
import { inputVariables, type VariableOption } from "../../domain/graph";
import { expressionSymbols } from "../../domain/expressionSymbols";
import { useFormulaSupport } from "./useFormulaSupport";

import { completionWord, isStringOrComment } from "./arcCompletion";
export {
  completionWord,
  isStringOrComment,
  insertSnippet,
} from "./arcCompletion";

/** Providers belong to one model; nested rule dialogs do not leak suggestions into each other. */
export function useArcLanguageSupport(
  editor: RefObject<monaco.editor.IStandaloneCodeEditor | null>,
  editorModel: monaco.editor.ITextModel | null,
  functions: FunctionEntry[],
  definition: Definition | VariableOption[],
  includeModules = true,
) {
  const variables: VariableOption[] = useMemo(
    () =>
      Array.isArray(definition)
        ? definition
        : [
            ...inputVariables(definition),
            ...definition.nodes.flatMap((node): VariableOption[] =>
              node.output
                ? [{ name: node.output, type: "RESULT", label: node.label }]
                : [],
            ),
          ],
    [definition],
  );
  const formulaSupport = useFormulaSupport(
    editor,
    editorModel,
    variables,
    !Array.isArray(definition),
  );
  useEffect(() => {
    // Providers must register after Monaco attaches the model. An initial token
    // request before onMount otherwise returns null and may never be retried.
    if (!editorModel || editorModel.isDisposed()) return;
    const colors = monaco.languages.registerDocumentSemanticTokensProvider(
      "arc",
      {
        getLegend: () => ({
          tokenTypes: ["function", "parameter", "variable", "formula"],
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
              symbol.kind === "formula"
                ? 3
                : symbol.kind === "function"
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
        if (w.word.startsWith("@")) return { suggestions: [] };
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
        const offset = model.getOffsetAt(position);
        const symbol = expressionSymbols(
          model.getValue(),
          variables,
          !Array.isArray(definition),
        ).find(
          (entry) =>
            offset >= entry.offset && offset < entry.offset + entry.length,
        );
        if (symbol?.kind === "formula") return null;
        if (symbol?.kind === "variable.local")
          return {
            contents: [
              {
                value:
                  "Collection-local variable. Visible only inside this collection body.",
              },
            ],
          };
        if (symbol?.kind === "parameter" || symbol?.kind === "variable") {
          const name = model
            .getValue()
            .slice(symbol.offset, symbol.offset + symbol.length);
          const variable = variables.find((entry) => entry.name === name);
          if (!variable) return null;
          return {
            contents: [
              { value: "```arc\n" + variable.name + "\n```" },
              {
                value:
                  variable.type === "RESULT"
                    ? "Node result"
                    : `Input · ${variable.type.toLowerCase()}`,
              },
              { value: `From: ${variable.label}` },
            ],
          };
        }
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
  }, [editor, editorModel, functions, definition, variables, includeModules]);
  return formulaSupport;
}
