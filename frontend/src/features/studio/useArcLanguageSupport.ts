import { useEffect, useMemo, useRef, type RefObject } from "react";
import { monaco } from "./arcLanguage";
import type { Definition, FunctionEntry } from "../../types";
import { modules } from "./snippets";
import { declaredVariables, type VariableOption } from "../../domain/graph";
import {
  expressionSymbols,
  type ExpressionSymbol,
  type ExpressionSymbolKind,
} from "../../domain/expressionSymbols";
import { useFormulaSupport } from "./useFormulaSupport";

import {
  completionWord,
  isStringOrComment,
  refreshOpenSuggestions,
} from "./arcCompletion";
export {
  completionWord,
  isStringOrComment,
  insertSnippet,
} from "./arcCompletion";

export type ArcEditorContext =
  | { kind: "expression"; variables: VariableOption[] }
  | { kind: "node" | "script"; definition: Definition };

const semanticLegend: monaco.languages.SemanticTokensLegend = {
  tokenTypes: ["function", "parameter", "variable", "formula"],
  tokenModifiers: ["local"],
};

/** Indexes into semanticLegend for each symbol kind. */
const semanticToken: Record<
  ExpressionSymbolKind,
  { type: number; modifiers: number }
> = {
  function: { type: 0, modifiers: 0 },
  parameter: { type: 1, modifiers: 0 },
  variable: { type: 2, modifiers: 0 },
  "variable.local": { type: 2, modifiers: 1 },
  formula: { type: 3, modifiers: 0 },
};

/** Monaco's relative encoding: line delta, start delta, length, type, modifiers per symbol. */
function semanticTokenData(
  model: monaco.editor.ITextModel,
  symbols: ExpressionSymbol[],
): Uint32Array {
  const data: number[] = [];
  let previousLine = 0;
  let previousColumn = 0;
  for (const symbol of symbols) {
    const position = model.getPositionAt(symbol.offset);
    const line = position.lineNumber - 1;
    const column = position.column - 1;
    const token = semanticToken[symbol.kind];
    data.push(
      line - previousLine,
      line === previousLine ? column - previousColumn : column,
      symbol.length,
      token.type,
      token.modifiers,
    );
    previousLine = line;
    previousColumn = column;
  }
  return new Uint32Array(data);
}

/**
 * Providers belong to one model; nested rule dialogs do not leak suggestions
 * into each other. They are registered once per model and read the latest
 * variables, because every graph edit produces a new variables array and a
 * registration change restarts any open suggestion list.
 */
export function useArcLanguageSupport(
  editor: RefObject<monaco.editor.IStandaloneCodeEditor | null>,
  editorModel: monaco.editor.ITextModel | null,
  functions: FunctionEntry[],
  context: ArcEditorContext,
) {
  const definition = context.kind === "expression" ? null : context.definition;
  const declarations = useMemo(
    () => (definition ? declaredVariables(definition) : []),
    [definition],
  );
  const variables =
    context.kind === "expression" ? context.variables : declarations;
  const scriptSyntax = context.kind !== "expression";
  const includeModules = context.kind === "script";
  const formulaSupport = useFormulaSupport(
    editor,
    editorModel,
    variables,
    scriptSyntax,
  );
  const latestVariables = useRef(variables);
  latestVariables.current = variables;
  const recolor = useRef<monaco.Emitter<void> | null>(null);

  // The function catalog arrives once per page load. Re-registering then lets
  // Monaco refresh a suggestion list opened while the catalog was loading.
  useEffect(() => {
    // Providers must register after Monaco attaches the model. An initial token
    // request before onMount otherwise returns null and may never be retried.
    if (!editorModel || editorModel.isDisposed()) return;
    const colorsChanged = new monaco.Emitter<void>();
    recolor.current = colorsChanged;
    const colors = monaco.languages.registerDocumentSemanticTokensProvider(
      "arc",
      {
        onDidChange: colorsChanged.event,
        getLegend: () => semanticLegend,
        provideDocumentSemanticTokens: (model) => {
          if (model !== editor.current?.getModel()) return null;
          const symbols = expressionSymbols(
            model.getValue(),
            latestVariables.current,
            scriptSyntax,
          );
          return { data: semanticTokenData(model, symbols) };
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
            ...(functionOnly ? [] : latestVariables.current).map(
              (variable) => ({
                label: variable.name,
                kind: monaco.languages.CompletionItemKind.Variable,
                insertText: variable.name,
                range,
              }),
            ),
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
          latestVariables.current,
          scriptSyntax,
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
          const variable = latestVariables.current.find(
            (entry) => entry.name === name,
          );
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
      colorsChanged.dispose();
      recolor.current = null;
    };
  }, [editor, editorModel, functions, scriptSyntax, includeModules]);

  // The registrations stay fixed while the scope changes. Repaint colors and
  // refresh an open suggestion list only when variable names or roles change.
  const variablesKey = JSON.stringify(
    variables.map((variable) => [variable.name, variable.type]),
  );
  useEffect(() => {
    recolor.current?.fire();
    refreshOpenSuggestions(editor.current);
  }, [editor, variablesKey]);
  return formulaSupport;
}
