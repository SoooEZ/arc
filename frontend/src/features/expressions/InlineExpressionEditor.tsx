import { useEffect, useState } from "react";
import MonacoEditor from "@monaco-editor/react";
import {
  inlineExpressionEditorOptions,
  useArcEditor,
  useEditorOptions,
} from "../studio/useArcEditor";
import {
  completionWord,
  isStringOrComment,
  useArcLanguageSupport,
} from "../studio/useArcLanguageSupport";
import { useFunctionCatalog } from "../studio/useFunctionCatalog";
import { formulaSuggestionProblem } from "../studio/useFormulaSupport";
import type { VariableOption } from "../../domain/variables";

/** Help under the editor; a failed suggestion source explains the missing completions. */
function helpText(
  formulaError: string,
  catalogError: string,
  helperText: string | undefined,
): string {
  if (formulaError) return formulaSuggestionProblem(formulaError);
  if (catalogError)
    return "Function suggestions unavailable. Reopen this node to retry.";
  return helperText || "ARC expression · Tab completes suggestions or indents.";
}

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
  const { editor, model, onMount } = useArcEditor();
  const options = useEditorOptions(
    inlineExpressionEditorOptions,
    readOnly,
    label,
  );
  const [catalogRequested, setCatalogRequested] = useState(false);
  // A Switch may have twenty case editors; load function help only when used.
  const { data: functions, error } = useFunctionCatalog(catalogRequested);
  const { formulaError } = useArcLanguageSupport(editor, model, functions, {
    kind: "expression",
    variables,
  });
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
    const word = completionWord(model, position).word;
    if (!word) return;
    if (isStringOrComment(model, position)) return;
    const functionPrefix = word.startsWith("$") ? word : "$" + word;
    const hasMatch =
      (!word.startsWith("$") &&
        variables.some(
          (variable) =>
            variable.name !== word && variable.name.startsWith(word),
        )) ||
      functions.some(
        (entry) =>
          entry.supported &&
          entry.name.startsWith(functionPrefix.toUpperCase()),
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
          options={options}
        />
      </fieldset>
      <p className="inline-expression-help">
        {helpText(formulaError, error, helperText)}
      </p>
    </div>
  );
}
