import MonacoEditor from "@monaco-editor/react";
import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
} from "@mui/material";
import {
  useArcLanguageSupport,
  insertSnippet,
} from "../studio/useArcLanguageSupport";
import FunctionLibrary from "../studio/FunctionLibrary";
import ExpressionColorKey from "../studio/ExpressionColorKey";
import { useArcEditor, arcEditorOptions } from "../studio/useArcEditor";
import { studioApi } from "../../api/studio";
import { useAsyncResource } from "../../hooks/useAsyncResource";
import { useNodeExpressionDraft } from "./useNodeExpressionDraft";
import type { Definition, FunctionEntry, RuleNode } from "../../types";

export default function NodeExpressionDialog({
  definition,
  node,
  readOnly,
  onApply,
  onClose,
  onProblems,
}: {
  definition: Definition;
  node: RuleNode;
  readOnly: boolean;
  onApply: (d: Definition) => void;
  onClose: () => void;
  onProblems: (messages: string[]) => void;
}) {
  const { source, changeSource, diagnostics, error, busy, apply } =
    useNodeExpressionDraft({
      definition,
      nodeId: node.id,
      readOnly,
      onApply,
      onClose,
      onProblems,
    });
  const { data: functions, error: catalogError } = useAsyncResource(
    "functions",
    (signal) => studioApi.functions({ signal }),
    [] as FunctionEntry[],
  );
  const { editor, model, onMount } = useArcEditor(diagnostics, "arc-node");
  const { insertFormula } = useArcLanguageSupport(
    editor,
    model,
    functions,
    definition,
  );
  const insert = (snippet: string) => {
    if (!readOnly) insertSnippet(editor.current, snippet);
  };
  return (
    <Dialog
      open
      onClose={busy ? undefined : onClose}
      maxWidth="lg"
      fullWidth
      aria-labelledby="node-expression-title"
      className="node-expression-dialog"
    >
      <DialogTitle id="node-expression-title">
        Node expression · {node.label}
      </DialogTitle>
      <DialogContent className="node-expression-content">
        <p className="muted-copy">
          Edit this node’s expressions, parameter mappings, result and
          connections. Keep its ID and type.{" "}
          {node.type === "INPUT" &&
            "Input parameters and source mappings are included."}
        </p>
        <ExpressionColorKey />
        {source === null ? (
          <CircularProgress size={24} />
        ) : (
          <div className="node-code-layout">
            <aside className="studio-library">
              <FunctionLibrary
                functions={functions}
                readOnly={readOnly || busy}
                onInsert={insert}
                onInsertFormula={insertFormula}
              />
            </aside>
            <MonacoEditor
              language="arc"
              theme="arc-light"
              value={source}
              onChange={(s) => changeSource(s ?? "")}
              onMount={onMount}
              options={{
                ...arcEditorOptions,
                readOnly: readOnly || busy,
                ariaLabel: "Node code editor",
              }}
            />
          </div>
        )}
        {diagnostics.map((d, i) => (
          <Alert key={i} severity="error">
            Line {d.line}: {d.message}
          </Alert>
        ))}
        {(error || catalogError) && (
          <Alert severity="error">{error || catalogError}</Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          {readOnly ? "Close" : "Cancel"}
        </Button>
        {!readOnly && (
          <Button
            variant="contained"
            disabled={busy || source === null || !!diagnostics.length}
            onClick={() => void apply()}
          >
            Apply to graph
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
