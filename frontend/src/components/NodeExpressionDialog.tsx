import { useEffect, useRef, useState } from "react";
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
import { monaco } from "./arcLanguage";
import FunctionLibrary from "./FunctionLibrary";
import { api, errorMessage } from "../api";
import type { Definition, Diagnostic, FunctionEntry, RuleNode } from "../types";

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
  const [source, setSource] = useState<string | null>(null);
  const [functions, setFunctions] = useState<FunctionEntry[]>([]);
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const validationSequence = useRef(0);
  useEffect(() => {
    let live = true;
    Promise.all([api.renderNode(definition, node.id), api.functions()])
      .then(([code, catalog]) => {
        if (live) {
          setSource(code.source);
          setFunctions(catalog);
        }
      })
      .catch((e) => {
        if (live) setError(errorMessage(e));
      });
    return () => {
      live = false;
    };
  }, [definition, node.id]);
  useEffect(() => {
    if (source === null || readOnly) return;
    const sequence = ++validationSequence.current;
    let live = true;
    const timer = setTimeout(async () => {
      try {
        const built = await api.buildNode(definition, node.id, source);
        const issues = built.definition
          ? await api.diagnostics(built.definition)
          : [];
        if (!live || sequence !== validationSequence.current) return;
        const messages = issues
          .filter((p) =>
            p.locations.some((l) => !l.ruleId && l.nodeId === node.id),
          )
          .map((p) => p.message);
        setDiagnostics(built.diagnostics);
        setError(messages.join("\n"));
        onProblems([...built.diagnostics.map((d) => d.message), ...messages]);
      } catch (e) {
        if (live) setError(errorMessage(e));
      }
    }, 350);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [source, definition, node.id, readOnly, onProblems]);
  useEffect(() => {
    const model = editor.current?.getModel();
    if (model)
      monaco.editor.setModelMarkers(
        model,
        "arc-node",
        diagnostics.map((d) => ({
          severity: monaco.MarkerSeverity.Error,
          message: d.message,
          startLineNumber: d.line,
          endLineNumber: d.line,
          startColumn: d.column,
          endColumn: d.column + 1,
        })),
      );
  }, [diagnostics]);
  const insert = (snippet: string) => {
    if (readOnly) return;
    const e = editor.current;
    e?.focus();
    e?.getContribution<{ insert: (text: string) => void; dispose: () => void }>(
      "snippetController2",
    )?.insert(snippet);
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
        {source === null ? (
          <CircularProgress size={24} />
        ) : (
          <div className="node-code-layout">
            <aside className="studio-library">
              <FunctionLibrary
                functions={functions}
                readOnly={readOnly || busy}
                onInsert={insert}
              />
            </aside>
            <MonacoEditor
              language="arc"
              theme="arc-light"
              value={source}
              onChange={(s) => setSource(s ?? "")}
              onMount={(e) => {
                editor.current = e;
              }}
              options={{
                readOnly: readOnly || busy,
                automaticLayout: true,
                tabSize: 2,
                insertSpaces: true,
                minimap: { enabled: false },
                fontFamily: "JetBrains Mono, monospace",
                fontSize: 12,
                wordWrap: "on",
                scrollBeyondLastLine: false,
                fixedOverflowWidgets: true,
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
        {error && <Alert severity="error">{error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          {readOnly ? "Close" : "Cancel"}
        </Button>
        {!readOnly && (
          <Button
            variant="contained"
            disabled={busy || source === null || !!diagnostics.length}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                const result = await api.buildNode(
                  definition,
                  node.id,
                  source!,
                );
                setDiagnostics(result.diagnostics);
                if (result.definition) {
                  onApply(result.definition);
                  onClose();
                } else onProblems(result.diagnostics.map((d) => d.message));
              } catch (e) {
                setError(errorMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Apply to graph
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
