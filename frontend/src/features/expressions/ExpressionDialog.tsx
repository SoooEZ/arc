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
import {
  useArcLanguageSupport,
  insertSnippet,
} from "../studio/useArcLanguageSupport";
import { useAsyncResource } from "../../hooks/useAsyncResource";
import { studioApi } from "../../api/studio";
import type { FunctionEntry } from "../../types";
import { variableOptionLabel, type VariableOption } from "../../domain/graph";

export default function ExpressionDialog({
  label,
  value,
  variables,
  readOnly,
  onClose,
  onApply,
}: {
  label: string;
  value: string;
  variables: VariableOption[];
  readOnly: boolean;
  onClose: () => void;
  onApply: (value: string) => void;
}) {
  const [source, setSource] = useState(value);
  const { editor, onMount } = useArcEditor();
  const { data: functions, error: catalogError } = useAsyncResource(
    "functions",
    (signal) => studioApi.functions({ signal }),
    [] as FunctionEntry[],
  );
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
  useArcLanguageSupport(editor, functions, names, false);
  const missing =
    check?.variables.filter((name) => !names.includes(name)) ?? [];
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
          Functions start with $. Use upstream variables as arguments. Tab moves
          between arguments; Ctrl/⌘ Space opens suggestions.
        </p>
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
            />
            {catalogError && <Alert severity="error">{catalogError}</Alert>}
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
