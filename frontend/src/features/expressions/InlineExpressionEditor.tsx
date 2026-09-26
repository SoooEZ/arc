import { useEffect, useState } from "react";
import MonacoEditor from "@monaco-editor/react";
import { arcEditorOptions, useArcEditor } from "../studio/useArcEditor";
import { useArcLanguageSupport } from "../studio/useArcLanguageSupport";
import { useAsyncResource } from "../../hooks/useAsyncResource";
import { studioApi } from "../../api/studio";
import type { VariableOption } from "../../domain/graph";
import type { FunctionEntry } from "../../types";
import { monaco } from "../studio/arcLanguage";

/** The caller owns the expression, including incomplete syntax while typing. */
export default function InlineExpressionEditor({
  label,
  value,
  variables,
  readOnly,
  onChange,
  helperText,
}: {
  label: string;
  value: string;
  variables: VariableOption[];
  readOnly: boolean;
  onChange: (value: string) => void;
  helperText?: string;
}) {
  const { editor, onMount } = useArcEditor();
  const [catalogRequested, setCatalogRequested] = useState(false);
  // A Switch may have twenty case editors; load function help only when used.
  const { data: functions, error } = useAsyncResource(
    "functions",
    (signal) => studioApi.functions({ signal }),
    [] as FunctionEntry[],
    0,
    catalogRequested,
  );
  useArcLanguageSupport(
    editor,
    functions,
    variables.map((variable) => variable.name),
    false,
  );
  const completionNames = JSON.stringify([
    ...variables.map((variable) => variable.name),
    ...functions.filter((entry) => entry.supported).map((entry) => entry.name),
  ]);
  useEffect(() => {
    const instance = editor.current;
    const model = instance?.getModel();
    const position = instance?.getPosition();
    if (
      readOnly ||
      !instance?.hasTextFocus() ||
      !instance.getSelection()?.isEmpty() ||
      !model ||
      !position
    )
      return;
    const word = model.getWordUntilPosition(position).word;
    if (!word) return;
    const tokens = monaco.editor.tokenize(
      model.getLineContent(position.lineNumber),
      "arc",
    )[0];
    let token: monaco.Token | undefined;
    for (const entry of tokens ?? []) {
      if (entry.offset >= position.column - 1) break;
      token = entry;
    }
    if (token?.type.startsWith("string") || token?.type.startsWith("comment"))
      return;
    const hasMatch =
      variables.some(
        (variable) => variable.name !== word && variable.name.startsWith(word),
      ) ||
      functions.some(
        (entry) => entry.supported && entry.name.startsWith(word.toUpperCase()),
      );
    // Scope and catalog reads can finish after Monaco's initial suggestion
    // request. Refresh only the focused, still-matching prefix with fresh data.
    if (hasMatch) instance.trigger("arc", "editor.action.triggerSuggest", {});
    // The serialized names describe completion changes, not every graph edit.
  }, [completionNames, editor, readOnly]);

  return (
    <div className="inline-expression-field">
      <fieldset
        className="inline-expression-editor"
        data-readonly={readOnly}
        onFocusCapture={() => {
          if (!readOnly) setCatalogRequested(true);
        }}
      >
        <legend>{label}</legend>
        <MonacoEditor
          height={94}
          language="arc"
          theme="arc-light"
          value={value}
          onChange={(text) => {
            if (!readOnly) onChange(text ?? "");
          }}
          onMount={onMount}
          options={{
            ...arcEditorOptions,
            readOnly,
            ariaLabel: label,
            lineNumbers: "off",
            folding: false,
            glyphMargin: false,
            lineDecorationsWidth: 0,
            lineNumbersMinChars: 0,
            renderLineHighlight: "none",
            overviewRulerLanes: 0,
            hideCursorInOverviewRuler: true,
            padding: { top: 6, bottom: 6 },
            scrollbar: { vertical: "auto", horizontal: "hidden" },
            tabCompletion: "on",
            wordBasedSuggestions: "off",
            quickSuggestions: { other: true, comments: false, strings: false },
            acceptSuggestionOnEnter: "off",
            suggest: { showWords: false, preview: false },
          }}
        />
      </fieldset>
      <p className="inline-expression-help">
        {error
          ? "Function suggestions unavailable. Reopen this node to retry."
          : helperText ||
            "ARC expression · Tab completes suggestions or indents."}
      </p>
    </div>
  );
}
