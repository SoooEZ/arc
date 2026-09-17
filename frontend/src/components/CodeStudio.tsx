import { useEffect, useRef, useState } from "react";
import MonacoEditor, { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor/editor/editor.api";
import "monaco-editor/features/register.all";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";
import {
  Alert,
  Button,
  Chip,
  MenuItem,
  TextField,
  Tooltip,
} from "@mui/material";
import { Braces, Check, Code2, GitBranch, Puzzle, Search } from "lucide-react";
import { api, errorMessage } from "../api";
import type { Definition, Diagnostic, FunctionEntry, Rule } from "../types";

self.MonacoEnvironment = { getWorker: () => new EditorWorker() };
loader.config({ monaco });
monaco.languages.register({ id: "arc" });
monaco.languages.setLanguageConfiguration("arc", {
  comments: { lineComment: "//" },
  brackets: [
    ["{", "}"],
    ["(", ")"],
    ["[", "]"],
  ],
  autoClosingPairs: [
    { open: '"', close: '"' },
    { open: "{", close: "}" },
    { open: "(", close: ")" },
    { open: "[", close: "]" },
  ],
  indentationRules: {
    increaseIndentPattern: /\{[^}]*$/,
    decreaseIndentPattern: /^\s*\}/,
  },
});
monaco.languages.setMonarchTokensProvider("arc", {
  tokenizer: {
    root: [
      [/\/\/.*$/, "comment"],
      [/"([^"\\]|\\.)*"|'([^'\\]|\\.)*'/, "string"],
      [
        /\b(schema|inputs|node|at|let|when|return|use|version|bind|as|next|edge|source|required|optional|default)\b/,
        "keyword",
      ],
      [
        /\b(INPUT|FORMULA|CONDITION|REFERENCE|OUTPUT|NUMBER|STRING|BOOLEAN|ARRAY|OBJECT)\b/,
        "type",
      ],
      [/\b(true|false|null)\b/, "constant"],
      [/[A-Za-z_][\w.]*(?=\s*\()/, "function"],
      [/\d+(\.\d+)?/, "number"],
      [/[{}()[\]]/, "@brackets"],
      [/[+\-*/=><!&|^]+/, "operator"],
    ],
  },
});
monaco.editor.defineTheme("arc-light", {
  base: "vs",
  inherit: true,
  rules: [
    { token: "keyword", foreground: "875295" },
    { token: "type", foreground: "327966" },
    { token: "function", foreground: "8B682F" },
    { token: "comment", foreground: "8C9792" },
    { token: "string", foreground: "277B61" },
  ],
  colors: {
    "editor.background": "#fcfdfc",
    "editorLineNumber.foreground": "#a5b1aa",
    "editor.lineHighlightBackground": "#f2f6f3",
    "editor.selectionBackground": "#dbece2",
  },
});
const modules = [
  {
    name: "Formula",
    snippet:
      '\nnode "${1:calculate}" FORMULA "${2:Calculate}" {\n  let ${3:total} = ${4:ROUND(amount * 1.2, 2)};\n  next -> "${5:output}";\n}\n',
  },
  {
    name: "Decision branch",
    snippet:
      '\nnode "${1:decision}" CONDITION "${2:Check eligibility}" {\n  when ${3:amount >= 100};\n  true -> "${4:approved}";\n  false -> "${5:declined}";\n}\n',
  },
  {
    name: "Output",
    snippet:
      '\nnode "${1:output}" OUTPUT "${2:Result}" {\n  return ${3:total};\n}\n',
  },
  {
    name: "Input declaration",
    snippet: "${1:amount}: ${2:NUMBER} required default ${3:100};",
  },
  {
    name: "External parameter",
    snippet:
      'source ${1:taxRate} = {"id":"${2:country-tax}","version":1,"bindings":{"key":"${3:country}"},"pointer":"/rate","onError":"FAIL"};',
  },
];
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
  const [functions, setFunctions] = useState<FunctionEntry[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [reference, setReference] = useState(false);
  const [error, setError] = useState("");
  const [pane, setPane] = useState("functions");
  const latest = useRef({ onBuild, onSave });
  latest.current = { onBuild, onSave };
  useEffect(() => {
    let live = true;
    api
      .functions()
      .then((f) => {
        if (live) setFunctions(f);
      })
      .catch((e) => {
        if (live) setError(errorMessage(e));
      });
    return () => {
      live = false;
    };
  }, []);
  const insert = (snippet: string, atEnd = false) => {
    const e = editor.current;
    if (!e || readOnly) return;
    e.focus();
    if (atEnd) {
      const m = e.getModel()!;
      e.setPosition({
        lineNumber: m.getLineCount(),
        column: m.getLineMaxColumn(m.getLineCount()),
      });
    }
    e.getContribution<{ insert: (text: string) => void; dispose: () => void }>(
      "snippetController2",
    )?.insert(snippet);
  };
  useEffect(() => {
    const completions = monaco.languages.registerCompletionItemProvider("arc", {
      provideCompletionItems: (model, position) => {
        const w = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: w.startColumn,
          endColumn: w.endColumn,
        };
        return {
          suggestions: [
            ...functions
              .filter((f) => f.supported)
              .map((f) => ({
                label: f.name,
                kind: monaco.languages.CompletionItemKind.Function,
                detail: f.signature,
                documentation: f.description,
                insertText: f.snippet,
                insertTextRules:
                  monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                range,
              })),
            ...modules.map((m) => ({
              label: m.name,
              kind: monaco.languages.CompletionItemKind.Snippet,
              insertText: m.snippet,
              insertTextRules:
                monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              range,
            })),
            ...[
              ...definition.inputs.map((i) => i.name),
              ...definition.nodes.flatMap((n) => (n.output ? [n.output] : [])),
            ].map((name) => ({
              label: name,
              kind: monaco.languages.CompletionItemKind.Variable,
              insertText: name,
              range,
            })),
          ],
        };
      },
    });
    const hover = monaco.languages.registerHoverProvider("arc", {
      provideHover: (model, position) => {
        const w = model.getWordAtPosition(position);
        const f = functions.find((f) => f.name === w?.word.toUpperCase());
        return f
          ? {
              contents: [
                { value: "```arc\n" + f.signature + "\n```" },
                { value: f.description },
              ],
            }
          : null;
      },
    });
    return () => {
      completions.dispose();
      hover.dispose();
    };
  }, [functions, definition]);
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
  const shown = functions.filter(
    (f) =>
      f.supported !== reference &&
      (category === "All" || f.category === category) &&
      `${f.name} ${f.description}`.toLowerCase().includes(search.toLowerCase()),
  );
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
          <>
            <TextField
              size="small"
              placeholder="Search functions…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              slotProps={{ input: { startAdornment: <Search size={15} /> } }}
            />
            <TextField
              select
              size="small"
              label="Category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {[
                "All",
                "Math",
                "Logic",
                "Text",
                "Collections",
                "Lookup",
                "Statistics",
                "Date & time",
                "Finance",
                "Excel",
              ].map((c) => (
                <MenuItem key={c} value={c}>
                  {c}
                </MenuItem>
              ))}
            </TextField>
            <div className="function-scope">
              <button
                className={!reference ? "active" : ""}
                onClick={() => setReference(false)}
              >
                Available · {functions.filter((f) => f.supported).length}
              </button>
              <button
                className={reference ? "active" : ""}
                onClick={() => setReference(true)}
              >
                Reference only
              </button>
            </div>
            <p className="studio-hint">
              Hover for usage. Click to insert at your cursor. Arrays act as
              Excel ranges.
            </p>
            <div className="function-chips">
              {shown.map((f) => (
                <Tooltip
                  key={f.name}
                  arrow
                  placement="right"
                  title={
                    <div className="function-tooltip">
                      <strong>{f.signature}</strong>
                      <p>{f.description}</p>
                      <small>{f.origin}</small>
                    </div>
                  }
                >
                  <span>
                    <Chip
                      size="small"
                      label={f.name}
                      variant="outlined"
                      disabled={readOnly || !f.supported}
                      onClick={() => insert(f.snippet)}
                    />
                  </span>
                </Tooltip>
              ))}
            </div>
            {!shown.length && (
              <p className="studio-hint">No matching functions.</p>
            )}
          </>
        ) : pane === "modules" ? (
          <>
            <p className="studio-hint">
              Insert nodes at the end of your script, then connect their next /
              true / false targets. Input declarations go inside inputs.
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
        {error && (
          <Alert severity="error" onClose={() => setError("")}>
            {error}
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
