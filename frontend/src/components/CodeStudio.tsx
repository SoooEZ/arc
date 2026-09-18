import { useEffect, useRef, useState } from "react";
import MonacoEditor from "@monaco-editor/react";
import { monaco } from "./arcLanguage";
import FunctionLibrary from "./FunctionLibrary";
import { Alert, Button } from "@mui/material";
import { Braces, Check, Code2, GitBranch, Puzzle } from "lucide-react";
import { api, errorMessage } from "../api";
import type { Definition, Diagnostic, FunctionEntry, Rule } from "../types";

import { modules } from "../features/studio/snippets";
import {
  useArcLanguageSupport,
  insertSnippet,
} from "../features/studio/useArcLanguageSupport";
import { useAsyncResource } from "../hooks/useAsyncResource";
interface Props {
  rule: Rule;
  rules: Rule[];
  definition: Definition;
  source: string;
  onChange: (s: string) => void;
  diagnostics: Diagnostic[];
  readOnly: boolean;
  pending: boolean;
  onBuild: () => Promise<unknown>;
  onGraph: () => void;
  onSave: () => void;
}
export default function CodeStudio({
  rule,
  rules,
  definition,
  source,
  onChange,
  diagnostics,
  readOnly,
  pending,
  onBuild,
  onGraph,
  onSave,
}: Props) {
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const { data: functions, error: catalogError } = useAsyncResource(
    "functions",
    (signal) => api.functions({ signal }),
    [] as FunctionEntry[],
  );
  const [error, setError] = useState("");
  const [pane, setPane] = useState("functions");
  const latest = useRef({ onBuild, onSave });
  latest.current = { onBuild, onSave };
  const insert = (snippet: string, atEnd = false) => {
    if (!readOnly) insertSnippet(editor.current, snippet, atEnd);
  };
  useArcLanguageSupport(editor, functions, definition);
  useEffect(() => {
    const model = editor.current?.getModel();
    if (model)
      monaco.editor.setModelMarkers(
        model,
        "arc",
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
  const reuse = async (r: Rule) => {
    try {
      const v = await api.version(r.id, r.publishedVersion!);
      const bindings = v.definition.inputs
        .filter((p) => p.required && !p.source && p.defaultValue == null)
        .map(
          (p) =>
            `  bind ${p.name} = ${definition.inputs.some((x) => x.name === p.name) ? p.name : p.type === "STRING" ? '"value"' : p.type === "BOOLEAN" ? "true" : p.type === "ARRAY" ? "[]" : p.type === "OBJECT" ? "null" : "0"};`,
        )
        .join("\n");
      insert(
        `\nnode "reuse-${r.id}-${Math.random().toString(36).slice(2, 6)}" REFERENCE ${JSON.stringify(r.name)} {\n  use "${r.id}" version ${r.publishedVersion};\n${bindings}\n  as \${1:reusedResult};\n  next -> "\${2:output}";\n}\n`,
        true,
      );
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return (
    <div className="code-studio">
      <aside className="studio-library">
        <div className="studio-library-title">
          <Puzzle size={17} />
          <strong>Build with blocks</strong>
        </div>
        <div className="studio-tabs">
          {["functions", "modules", "reuse"].map((p) => (
            <button
              key={p}
              className={pane === p ? "active" : ""}
              onClick={() => setPane(p)}
            >
              {p}
            </button>
          ))}
        </div>
        {pane === "functions" ? (
          <FunctionLibrary
            functions={functions}
            readOnly={readOnly}
            onInsert={insert}
          />
        ) : pane === "modules" ? (
          <>
            <p className="studio-hint">
              Insert nodes at the end of your script, then connect their next /
              true / false / case / default targets. Input declarations go
              inside inputs.
            </p>
            {modules.map((m) => (
              <button
                className="snippet-card"
                key={m.name}
                disabled={readOnly}
                onClick={() =>
                  insert(
                    m.snippet,
                    m.name !== "Input declaration" &&
                      m.name !== "External parameter",
                  )
                }
              >
                <Braces size={17} />
                <span>{m.name}</span>
                <span>+</span>
              </button>
            ))}
          </>
        ) : (
          <>
            <p className="studio-hint">
              Insert a published rule or formula as a versioned module. Required
              input bindings are included.
            </p>
            {rules
              .filter((r) => r.publishedVersion && r.id !== rule.id)
              .map((r) => (
                <button
                  key={r.id}
                  className="snippet-card"
                  disabled={readOnly}
                  onClick={() => void reuse(r)}
                >
                  <GitBranch size={17} />
                  <span>
                    {r.name}
                    <small>
                      v{r.publishedVersion} · {r.kind.toLowerCase()}
                    </small>
                  </span>
                  <span>+</span>
                </button>
              ))}
          </>
        )}
        {(error || catalogError) && (
          <Alert
            severity="error"
            onClose={error ? () => setError("") : undefined}
          >
            {error || catalogError}
          </Alert>
        )}
      </aside>
      <div className="studio-editor">
        <div className="studio-filebar">
          <span>
            <Code2 size={16} />
            {rule.id}.arc{" "}
            <small>{pending ? "● edited" : "✓ graph synced"}</small>
          </span>
          <div>
            <Button
              size="small"
              onClick={() => void onBuild()}
              startIcon={<Check size={14} />}
            >
              Build graph
            </Button>
            <Button
              size="small"
              onClick={onGraph}
              startIcon={<GitBranch size={14} />}
            >
              Open graph
            </Button>
          </div>
        </div>
        <MonacoEditor
          language="arc"
          theme="arc-light"
          value={source}
          onChange={(s) => onChange(s ?? "")}
          onMount={(e) => {
            editor.current = e;
            e.addAction({
              id: "arc-build",
              label: "Build ARC graph",
              keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
              run: () => {
                void latest.current.onBuild();
              },
            });
            e.addAction({
              id: "arc-save",
              label: "Save ARC draft",
              keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
              run: () => latest.current.onSave(),
            });
          }}
          options={{
            readOnly,
            tabSize: 2,
            insertSpaces: true,
            automaticLayout: true,
            fontFamily: "JetBrains Mono, monospace",
            fontSize: 12,
            lineHeight: 23,
            minimap: { enabled: true },
            padding: { top: 20, bottom: 20 },
            scrollBeyondLastLine: false,
            wordWrap: "on",
            fixedOverflowWidgets: true,
            ariaLabel: "ARC code editor",
            suggest: { showWords: false },
          }}
        />
        <div
          className={`studio-problems ${diagnostics.length ? "has-errors" : ""}`}
        >
          <strong>
            {diagnostics.length
              ? `${diagnostics.length} build problem`
              : "ARC script"}
          </strong>
          {diagnostics.map((d, i) => (
            <button
              key={i}
              onClick={() => {
                editor.current?.revealLineInCenter(d.line);
                editor.current?.setPosition({
                  lineNumber: d.line,
                  column: d.column,
                });
                editor.current?.focus();
              }}
            >
              Ln {d.line}:{d.column} · {d.message}
            </button>
          ))}
          {!diagnostics.length && (
            <span>
              Tab to indent · ⌘/Ctrl Enter to build · ⌘/Ctrl S to save ·
              comments use //
            </span>
          )}
        </div>
      </div>
      <aside className="studio-outline">
        <h4>OUTLINE</h4>
        <span>
          {definition.nodes.length} nodes · {definition.edges.length}{" "}
          connections
        </span>
        {definition.nodes.map((n) => (
          <button
            key={n.id}
            onClick={() => {
              const m = editor.current?.getModel();
              const match =
                m?.findMatches(
                  `node "${n.id}"`,
                  false,
                  false,
                  false,
                  null,
                  false,
                )[0] ||
                m?.findMatches(
                  `node ${n.id} `,
                  false,
                  false,
                  false,
                  null,
                  false,
                )[0];
              if (match) {
                editor.current?.revealLineInCenter(match.range.startLineNumber);
                editor.current?.setPosition({
                  lineNumber: match.range.startLineNumber,
                  column: 1,
                });
                editor.current?.focus();
              }
            }}
          >
            <span
              className={`status-dot ${n.type === "OUTPUT" ? "published" : ""}`}
            />
            <span>
              {n.label}
              <small>{n.type.toLowerCase()}</small>
            </span>
          </button>
        ))}
        <p>
          Code and canvas share the same versioned graph. Build to apply code
          changes.
        </p>
      </aside>
    </div>
  );
}
