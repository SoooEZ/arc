import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { monaco } from "./arcLanguage";
import type { RuleSummary } from "../../types";
import type { VariableOption } from "../../domain/variables";
import { expressionSymbols } from "../../domain/expressionSymbols";
import { errorMessage } from "../../api/errors";
import { typeaheadDelayMs } from "../../hooks/useDebouncedValue";
import {
  formulaCallName,
  formulaParameterDescription,
  formulaSignature,
  formulaSnippet,
} from "./formulaCalls";
import { formulaMetadata } from "./formulaMetadata";
import {
  captureEditorState,
  completionWord,
  insertSnippet,
  isStringOrComment,
  unchangedSince,
} from "./arcCompletion";
import { markdownText } from "../../domain/text";

/** The help or alert text for a failed `@` search, the same in every editor. */
export function formulaSuggestionProblem(formulaError: string): string {
  return `Formula suggestions unavailable: ${formulaError}`;
}

/** Resolves true after `milliseconds`, or false as soon as Monaco cancels the request. */
function afterPause(
  token: monaco.CancellationToken,
  milliseconds: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      cancellation.dispose();
      resolve(!token.isCancellationRequested);
    }, milliseconds);
    const cancellation = token.onCancellationRequested(() => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

/**
 * Monaco keeps a completion request open while the user types ordinary
 * characters instead of cancelling it. Waiting until the text has not changed
 * for `typeaheadDelayMs` therefore sends one search for the settled prefix.
 */
async function typingPaused(
  model: monaco.editor.ITextModel,
  token: monaco.CancellationToken,
): Promise<boolean> {
  let version = model.getVersionId();
  for (;;) {
    if (!(await afterPause(token, typeaheadDelayMs)) || model.isDisposed())
      return false;
    if (model.getVersionId() === version) return true;
    version = model.getVersionId();
  }
}

/** The `@` word at the cursor while it still starts where the requested word started. */
function settledFormulaWord(
  editor: monaco.editor.IStandaloneCodeEditor | null,
  model: monaco.editor.ITextModel,
  requested: { lineNumber: number; startColumn: number },
): string | null {
  const cursor = editor?.getPosition();
  if (!cursor || cursor.lineNumber !== requested.lineNumber) return null;
  const word = completionWord(model, cursor);
  return word.startColumn === requested.startColumn && word.word.startsWith("@")
    ? word.word
    : null;
}

export function useFormulaSupport(
  editor: RefObject<monaco.editor.IStandaloneCodeEditor | null>,
  editorModel: monaco.editor.ITextModel | null,
  variables: VariableOption[],
  script: boolean,
) {
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
    // ARC Script or a single expression: the providers follow their model.
    const language = editorModel.getLanguageId();
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
    const completions = monaco.languages.registerCompletionItemProvider(
      language,
      {
        triggerCharacters: ["@"],
        provideCompletionItems: async (model, position, _context, token) => {
          if (
            model !== editorModel ||
            model !== editor.current?.getModel() ||
            isStringOrComment(model, position)
          )
            return { suggestions: [] };
          const requested = completionWord(model, position);
          if (!requested.word.startsWith("@")) return { suggestions: [] };
          // Monaco adjusts this request-time range for characters typed since.
          const range = new monaco.Range(
            position.lineNumber,
            requested.startColumn,
            position.lineNumber,
            requested.endColumn,
          );
          try {
            if (!(await typingPaused(model, token))) return { suggestions: [] };
            const word = settledFormulaWord(editor.current, model, {
              lineNumber: position.lineNumber,
              startColumn: requested.startColumn,
            });
            if (!word) return { suggestions: [] };
            const query = word.slice(1).split(":")[0];
            const entries = await load(token, (signal) =>
              formulaMetadata.search(query, signal),
            );
            if (
              token.isCancellationRequested ||
              model.isDisposed() ||
              model !== editor.current?.getModel()
            )
              return { suggestions: [] };
            setError("");
            // Monaco filters by what was typed since; a longer word re-requests.
            return {
              incomplete: true,
              suggestions: entries
                .filter(
                  (entry) =>
                    !word.includes(":") ||
                    formulaCallName(entry).startsWith(word),
                )
                .map((entry) => ({
                  label: formulaCallName(entry),
                  filterText: word,
                  kind: monaco.languages.CompletionItemKind.Function,
                  detail: `${entry.name} · ${formulaSignature(entry)}`,
                  documentation: entry.inputs
                    .map(formulaParameterDescription)
                    .join("\n\n"),
                  get insertText() {
                    // Monaco keeps old suggestions selectable while a scope-
                    // triggered refresh loads. Resolve argument placeholders
                    // from the authoritative scope when the item is accepted.
                    return formulaSnippet(
                      entry,
                      latestVariables.current.map((variable) => variable.name),
                    );
                  },
                  insertTextRules:
                    monaco.languages.CompletionItemInsertTextRule
                      .InsertAsSnippet,
                  range,
                })),
            };
          } catch (failure) {
            if (!token.isCancellationRequested) setError(errorMessage(failure));
            return { suggestions: [] };
          }
        },
      },
    );
    const hover = monaco.languages.registerHoverProvider(language, {
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
            formulaMetadata.load(call[1], Number(call[2]), signal),
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
              { value: markdownText(entry.name) },
              { value: "```arc\n" + formulaSignature(entry) + "\n```" },
              {
                value: `Published Formula · ${entry.id} · version ${entry.version}`,
              },
              ...entry.inputs.map((input) => ({
                value: markdownText(formulaParameterDescription(input)),
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

  // Reads the editor, the latest variables and the pending reads through refs,
  // so the function libraries that receive it can skip renders while typing.
  const insertFormula = useCallback(
    async (rule: RuleSummary, signal?: AbortSignal) => {
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
      const state = captureEditorState(instance);
      const controller = new AbortController();
      for (const previous of pending.current) previous.abort();
      pending.current.add(controller);
      const cancel = () => controller.abort();
      signal?.addEventListener("abort", cancel, { once: true });
      try {
        const formula = await formulaMetadata.load(
          rule.id,
          rule.publishedVersion,
          controller.signal,
          rule,
        );
        if (controller.signal.aborted) return;
        if (
          editor.current !== instance ||
          !unchangedSince(instance, state) ||
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
    },
    [editor],
  );
  return { insertFormula, formulaError: error };
}
