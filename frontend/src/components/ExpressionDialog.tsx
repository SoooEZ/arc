import { useRef, useState } from "react";
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
import { monaco } from "./arcLanguage";
import FunctionLibrary from "./FunctionLibrary";
import {
  useArcLanguageSupport,
  insertSnippet,
} from "../features/studio/useArcLanguageSupport";
import { useAsyncResource } from "../hooks/useAsyncResource";
import { studioApi } from "../api/studio";
import type { FunctionEntry } from "../types";
import type { VariableOption } from "../domain/graph";

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
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
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
          Use nested functions and upstream variables. Tab moves between
          function arguments; Ctrl/⌘ Space opens suggestions.
        </p>
        <div className="expression-variable-chips">
          {variables.map((variable) => (
            <Tooltip key={variable.name} title={variable.label}>
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
              editor.current = instance;
              instance.focus();
            }}
            options={{
              readOnly,
              automaticLayout: true,
              tabSize: 2,
              insertSpaces: true,
              minimap: { enabled: false },
              fontFamily: "JetBrains Mono, monospace",
              fontSize: 13,
              wordWrap: "on",
              scrollBeyondLastLine: false,
              fixedOverflowWidgets: true,
              ariaLabel: "Expression code editor",
              suggest: { showWords: false },
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
