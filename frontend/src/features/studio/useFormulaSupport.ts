import { useEffect, useRef, useState, type RefObject } from "react";
import { monaco } from "./arcLanguage";
import type { RuleSummary } from "../../types";
import type { VariableOption } from "../../domain/graph";
import { expressionSymbols } from "../../domain/expressionSymbols";
import { errorMessage } from "../../api/errors";
import {
  FormulaMetadata,
  formulaCallName,
  formulaParameterDescription,
  formulaSignature,
  formulaSnippet,
} from "./formulaCalls";
import {
  completionWord,
  insertSnippet,
  isStringOrComment,
} from "./arcCompletion";

export function useFormulaSupport(
  editor: RefObject<monaco.editor.IStandaloneCodeEditor | null>,
  editorModel: monaco.editor.ITextModel | null,
  variables: VariableOption[],
  script: boolean,
) {
  const metadata = useRef(new FormulaMetadata());
  const latestVariables = useRef(variables);
  latestVariables.current = variables;
  const pending = useRef(new Set<AbortController>());
  const [error, setError] = useState("");
  useEffect(
    () => () => {
      for (const controller of pending.current) controller.abort();
      pending.current.clear();
    },
    [],
  );

  useEffect(() => {
    if (!editorModel || editorModel.isDisposed()) return;
    const requests = new Set<AbortController>();
    const load = async <T>(
      token: monaco.CancellationToken,
      action: (signal: AbortSignal) => Promise<T>,
    ) => {
      const controller = new AbortController();
      requests.add(controller);
      const cancellation = token.onCancellationRequested(() =>
        controller.abort(),
      );
      try {
        return await action(controller.signal);
      } finally {
        cancellation.dispose();
        requests.delete(controller);
      }
    };
    const completions = monaco.languages.registerCompletionItemProvider("arc", {
      triggerCharacters: ["@"],
      provideCompletionItems: async (model, position, _context, token) => {
        if (
          model !== editorModel ||
          model !== editor.current?.getModel() ||
          isStringOrComment(model, position)
        )
          return { suggestions: [] };
        const word = completionWord(model, position);
        if (!word.word.startsWith("@")) return { suggestions: [] };
        const before = model.getVersionId();
        const range = new monaco.Range(
          position.lineNumber,
          word.startColumn,
          position.lineNumber,
          word.endColumn,
        );
        try {
          const query = word.word.slice(1).split(":")[0];
          const entries = await load(token, (signal) =>
            metadata.current.search(query, signal),
          );
          if (
            token.isCancellationRequested ||
            model.isDisposed() ||
            model.getVersionId() !== before ||
            model !== editor.current?.getModel()
          )
            return { suggestions: [] };
          setError("");
          return {
            incomplete: true,
            suggestions: entries
              .filter(
                (entry) =>
                  !word.word.includes(":") ||
                  formulaCallName(entry).startsWith(word.word),
              )
              .map((entry) => ({
                label: formulaCallName(entry),
                filterText: word.word,
                kind: monaco.languages.CompletionItemKind.Function,
                detail: `${entry.name} · ${formulaSignature(entry)}`,
                documentation: entry.inputs
                  .map(formulaParameterDescription)
                  .join("\n\n"),
                insertText: formulaSnippet(
                  entry,
                  latestVariables.current.map((variable) => variable.name),
                ),
                insertTextRules:
                  monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                range,
              })),
          };
        } catch (failure) {
          if (!token.isCancellationRequested) setError(errorMessage(failure));
          return { suggestions: [] };
        }
      },
    });
    const hover = monaco.languages.registerHoverProvider("arc", {
      provideHover: async (model, position, token) => {
        if (
          model !== editorModel ||
          model !== editor.current?.getModel() ||
          isStringOrComment(model, position)
        )
          return null;
        const offset = model.getOffsetAt(position);
        const symbol = expressionSymbols(
          model.getValue(),
          latestVariables.current,
          script,
        ).find(
          (entry) =>
            entry.kind === "formula" &&
            offset >= entry.offset &&
            offset < entry.offset + entry.length,
        );
        if (!symbol) return null;
        const text = model
          .getValue()
          .slice(symbol.offset, symbol.offset + symbol.length);
        const call = /^@([a-z][a-z0-9-]*):([1-9]\d*)$/.exec(text);
        if (!call) return null;
        const before = model.getVersionId();
        try {
          const entry = await load(token, (signal) =>
            metadata.current.load(call[1], Number(call[2]), signal),
          );
          if (
            token.isCancellationRequested ||
            model.isDisposed() ||
            model.getVersionId() !== before ||
            model !== editor.current?.getModel()
          )
            return null;
          return {
            contents: [
              { value: entry.name },
              { value: "```arc\n" + formulaSignature(entry) + "\n```" },
              {
                value: `Published Formula · ${entry.id} · version ${entry.version}`,
              },
              ...entry.inputs.map((input) => ({
                value: formulaParameterDescription(input),
              })),
            ],
          };
        } catch {
          return null;
        }
      },
    });
    return () => {
      completions.dispose();
      hover.dispose();
      for (const controller of requests) controller.abort();
    };
  }, [editor, editorModel, script]);

  const insertFormula = async (rule: RuleSummary, signal?: AbortSignal) => {
    const instance = editor.current;
    const model = instance?.getModel();
    const selection = instance?.getSelection();
    if (
      !instance ||
      !model ||
      !selection ||
      signal?.aborted ||
      rule.publishedVersion === null ||
      instance.getOption(monaco.editor.EditorOption.readOnly)
    )
      return;
    const revision = model.getVersionId();
    const controller = new AbortController();
    for (const previous of pending.current) previous.abort();
    pending.current.add(controller);
    const cancel = () => controller.abort();
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      const formula = await metadata.current.load(
        rule.id,
        rule.publishedVersion,
        controller.signal,
        rule,
      );
      if (controller.signal.aborted) return;
      if (
        model.isDisposed() ||
        editor.current !== instance ||
        instance.getModel() !== model ||
        model.getVersionId() !== revision ||
        !instance.getSelection()?.equalsSelection(selection) ||
        instance.getOption(monaco.editor.EditorOption.readOnly)
      )
        throw new Error(
          "The expression changed while the formula loaded. Select the formula again.",
        );
      insertSnippet(
        instance,
        formulaSnippet(
          formula,
          latestVariables.current.map((variable) => variable.name),
        ),
      );
    } finally {
      pending.current.delete(controller);
      signal?.removeEventListener("abort", cancel);
    }
  };
  return { insertFormula, formulaError: error };
}
