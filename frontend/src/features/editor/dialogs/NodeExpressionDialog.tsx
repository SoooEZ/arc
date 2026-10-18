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
} from "../../language/useArcLanguageSupport";
import FunctionLibrary from "../../language/FunctionLibrary";
import ExpressionColorKey from "../../language/ExpressionColorKey";
import {
  nodeCodeOptions,
  useArcEditor,
  useEditorOptions,
} from "../../language/useArcEditor";
import { useFunctionCatalog } from "../../language/useFunctionCatalog";
import { arcScriptLanguage } from "../../language/arcLanguage";
import { formulaSuggestionProblem } from "../../language/useFormulaSupport";
import { useNodeExpressionDraft } from "./useNodeExpressionDraft";
import { nodeKinds } from "../../../domain/nodeKinds";
import type { Definition, RuleNode } from "../../../types";

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
  /** Replaces the graph with the built one; false when the document refused it. */
  onApply: (built: Definition) => boolean;
  onClose: () => void;
  onProblems: (messages: string[]) => void;
}) {
  const { source, changeSource, dismiss, diagnostics, error, applying, apply } =
    useNodeExpressionDraft({
      definition,
      nodeId: node.id,
      readOnly,
      onApply,
      onClose,
      onProblems,
    });
  const { data: functions, error: catalogError } = useFunctionCatalog();
  const { editor, model, onMount } = useArcEditor(diagnostics, "arc-node");
  const { insertFormula, formulaError } = useArcLanguageSupport(
    editor,
    model,
    functions,
    { kind: "node", definition },
  );
  const formulaProblem = formulaError
    ? formulaSuggestionProblem(formulaError)
    : "";
  const insert = (snippet: string) => {
    if (!readOnly) insertSnippet(editor.current, snippet);
  };
  // Applying locks the buffer until the build answers. `readOnly` already
  // folds in the document's command lock (capabilities); this is the dialog's own.
  const locked = readOnly || applying;
  const options = useEditorOptions(nodeCodeOptions, locked, "Node code editor");
  return (
    <Dialog
      open
      onClose={applying ? undefined : dismiss}
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
          {nodeKinds[node.type].ownsInputs &&
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
                readOnly={locked}
                onInsert={insert}
                onInsertFormula={insertFormula}
              />
            </aside>
            <MonacoEditor
              language={arcScriptLanguage}
              theme="arc-light"
              value={source}
              onChange={(s) => changeSource(s ?? "")}
              onMount={onMount}
              options={options}
            />
          </div>
        )}
        {diagnostics.map((d, i) => (
          <Alert key={i} severity="error">
            Line {d.line}: {d.message}
          </Alert>
        ))}
        {(error || catalogError || formulaProblem) && (
          <Alert severity="error">
            {error || catalogError || formulaProblem}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={applying}>
          {readOnly ? "Close" : "Cancel"}
        </Button>
        {!readOnly && (
          <Button
            variant="contained"
            disabled={applying || source === null || !!diagnostics.length}
            onClick={() => void apply()}
          >
            Apply to graph
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
