import { useState } from "react";
import MonacoEditor from "@monaco-editor/react";
import {
  Alert,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Tooltip,
} from "@mui/material";
import { arcEditorOptions, useArcEditor } from "../studio/useArcEditor";
import FunctionLibrary from "../studio/FunctionLibrary";
import ExpressionColorKey from "../studio/ExpressionColorKey";
import {
  useArcLanguageSupport,
  insertSnippet,
} from "../studio/useArcLanguageSupport";
import { useFunctionCatalog } from "../studio/useFunctionCatalog";
import { formulaSuggestionProblem } from "../studio/useFormulaSupport";
import { useAsyncResource } from "../../hooks/useAsyncResource";
import { studioApi } from "../../api/studio";
import { variableOptionLabel, type VariableOption } from "../../domain/graph";

export default function ExpressionDialog({
  label,
  value,
  variables,
  scopeKnown = true,
  readOnly,
  onClose,
  onApply,
}: {
  label: string;
  value: string;
  variables: VariableOption[];
  /** False while the node's scope read is pending or failed (see NodeFieldsProps). */
  scopeKnown?: boolean;
  readOnly: boolean;
  onClose: () => void;
  onApply: (value: string) => void;
}) {
  const [source, setSource] = useState(value);
  const { editor, model, onMount } = useArcEditor();
  const { data: functions, error: catalogError } = useFunctionCatalog();
  const {
    data: check,
    error: checkError,
    loading,
  } = useAsyncResource(
    source,
    (signal) => studioApi.checkExpression(source, { signal }),
    null,
    250,
  );
  const names = variables.map((variable) => variable.name);
  const { insertFormula, formulaError } = useArcLanguageSupport(
    editor,
    model,
    functions,
    { kind: "expression", variables },
  );
  // An unknown scope cannot judge a variable unavailable, so it does not block Apply.
  const missing = scopeKnown
    ? (check?.variables.filter((name) => !names.includes(name)) ?? [])
    : [];
  const error =
    checkError ||
    check?.error ||
    (missing.length ? `Unavailable variables: ${missing.join(", ")}` : "");
  const insert = (snippet: string) => {
    if (!readOnly) insertSnippet(editor.current, snippet);
  };
  return (
    <Dialog
      open
      onClose={onClose}
      maxWidth="lg"
      fullWidth
      aria-labelledby="expression-editor-title"
    >
      <DialogTitle id="expression-editor-title">
        Expression editor · {label}
      </DialogTitle>
      <DialogContent className="node-expression-content">
        <p className="muted-copy">
          Functions start with $; published formulas start with @ and include a
          version. Use upstream variables as arguments. Tab moves between
          arguments; Ctrl/⌘ Space opens suggestions.
        </p>
        <ExpressionColorKey />
        <div className="expression-variable-chips">
          {variables.map((variable) => (
            <Tooltip key={variable.name} title={variableOptionLabel(variable)}>
              <Chip
                size="small"
                label={variable.name}
                disabled={readOnly}
                onClick={() => insert(variable.name)}
              />
            </Tooltip>
          ))}
        </div>
        <div className="node-code-layout">
          <aside className="studio-library">
            <FunctionLibrary
              functions={functions}
              readOnly={readOnly}
              onInsert={insert}
              onInsertFormula={insertFormula}
            />
            {catalogError && <Alert severity="error">{catalogError}</Alert>}
            {formulaError && (
              <Alert severity="error">
                {formulaSuggestionProblem(formulaError)}
              </Alert>
            )}
          </aside>
          <MonacoEditor
            language="arc"
            theme="arc-light"
            value={source}
            onChange={(text) => setSource(text ?? "")}
            onMount={(instance) => {
              onMount(instance);
              instance.focus();
            }}
            options={{
              readOnly,
              ...arcEditorOptions,
              fontSize: 13,
              ariaLabel: "Expression code editor",
            }}
          />
        </div>
        {!scopeKnown && (
          <Alert severity="info">
            Variable scope unavailable: the variables in scope at this node are
            checked once the scope read answers.
          </Alert>
        )}
        {error ? (
          <Alert severity="error">{error}</Alert>
        ) : (
          <p className="muted-copy" role="status">
            {loading
              ? "Checking expression…"
              : "Expression syntax is valid. Run a test to check values and result types."}
          </p>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{readOnly ? "Close" : "Cancel"}</Button>
        {!readOnly && (
          <Button
            variant="contained"
            disabled={loading || !check?.valid || !!error}
            onClick={() => onApply(source)}
          >
            Apply expression
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
