import { useCallback, useEffect, useRef, useState } from "react";
import MonacoEditor from "@monaco-editor/react";
import { Button, ToggleButton, ToggleButtonGroup } from "@mui/material";
import { Check, Code2 } from "lucide-react";
import { arcScriptLanguage, monaco } from "../language/arcLanguage";
import type { Definition, Diagnostic, Rule } from "../../types";
import { useFunctionCatalog } from "../language/useFunctionCatalog";
import {
  useArcLanguageSupport,
  insertSnippet,
} from "../language/useArcLanguageSupport";
import { captureEditorState, unchangedSince } from "../language/arcCompletion";
import {
  adoptSource,
  codeStudioOptions,
  useArcEditor,
  useEditorOptions,
} from "../language/useArcEditor";
import StudioLibrary from "./StudioLibrary";
import StudioOutline from "./StudioOutline";
import StudioProblems from "./StudioProblems";
import ExpressionColorKey from "../language/ExpressionColorKey";
import RuleJsonView, { type RuleJsonViewHandle } from "./RuleJsonView";
import { nodeDeclarationOffset } from "./scriptOutline";

/** What the editor shows: ARC code to edit, or the rule's JSON as stored. */
type Shown = "code" | "json";

/**
 * The code editor stays mounted while the JSON shows, so its caret and undo
 * history stay.
 */
const hiddenEditor = { style: { display: "none" } };

interface Props {
  rule: Rule;
  definition: Definition;
  source: string;
  onChange: (s: string) => void;
  diagnostics: Diagnostic[];
  readOnly: boolean;
  pending: boolean;
  onBuild: () => Promise<unknown>;
  onSave: () => void;
}
export default function CodeStudio({
  rule,
  definition,
  source,
  onChange,
  diagnostics,
  readOnly,
  pending,
  onBuild,
  onSave,
}: Props) {
  const { editor, model, onMount, reveal } = useArcEditor(diagnostics);
  const options = useEditorOptions(
    codeStudioOptions,
    readOnly,
    "ARC code editor",
  );
  const [shown, setShown] = useState<Shown>("code");
  const showsJson = shown === "json";
  const jsonView = useRef<RuleJsonViewHandle>(null);
  const { data: functions, error: catalogError } = useFunctionCatalog();
  const latest = useRef({ onBuild, onSave, readOnly, shown });
  latest.current = { onBuild, onSave, readOnly, shown };
  // The document owns the text. When a command adopts the server's canonical
  // source, the model follows through one undoable edit that keeps the caret;
  // typing already matches the document, so the adoption is a no-op for it.
  const adopting = useRef(false);
  useEffect(() => {
    if (!editor.current || !model || model.isDisposed()) return;
    adopting.current = true;
    try {
      adoptSource(editor.current, source);
    } finally {
      adopting.current = false;
    }
  }, [editor, model, source]);
  // The insertion callbacks read the editor and the latest state through refs,
  // so they stay the same while the code is typed, and the memoized function
  // library and outline beside it do not render again on every keystroke.
  const insert = useCallback(
    (snippet: string, atEnd = false) => {
      if (!latest.current.readOnly)
        insertSnippet(editor.current, snippet, atEnd);
    },
    [editor],
  );
  /**
   * An insertion that starts with a read: the returned function inserts only
   * while the code and the selection are as they were when the read started,
   * the rule Formula insertion applies (lesson F3).
   */
  const beginInsert = useCallback(() => {
    const state = captureEditorState(editor.current);
    return (snippet: string, atEnd = false) => {
      if (latest.current.readOnly) return;
      if (!unchangedSince(editor.current, state))
        throw new Error(
          "The code changed while the rule loaded. Choose the rule again.",
        );
      insertSnippet(editor.current, snippet, atEnd);
    };
  }, [editor]);
  const { insertFormula, formulaError } = useArcLanguageSupport(
    editor,
    model,
    functions,
    { kind: "script", definition },
  );

  // Both editors take the commands: without them, Ctrl/Cmd+S in the JSON
  // opened the browser's Save Page dialog (lesson F4).
  const addCommands = (instance: monaco.editor.IStandaloneCodeEditor) => {
    instance.addAction({
      id: "arc-build",
      label: "Build ARC graph",
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
      run: () => {
        void latest.current.onBuild();
      },
    });
    instance.addAction({
      id: "arc-save",
      label: "Save ARC draft",
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
      // No read-only precondition: an unmatched keybinding let the browser open its Save
      // Page dialog; the guard below refuses the press instead (lesson F4).
      run: () => {
        if (!latest.current.readOnly) latest.current.onSave();
      },
    });
  };
  const mount = (instance: monaco.editor.IStandaloneCodeEditor) => {
    onMount(instance);
    addCommands(instance);
  };
  const selectNode = useCallback(
    (nodeId: string) => {
      if (latest.current.shown === "json") {
        jsonView.current?.revealNode(nodeId);
        return;
      }
      const model = editor.current?.getModel();
      if (!model) return;
      const offset = nodeDeclarationOffset(model.getValue(), nodeId);
      if (offset === null) return;
      const declaration = model.getPositionAt(offset);
      reveal(declaration.lineNumber, declaration.column);
    },
    [editor, reveal],
  );
  // A problem is in the code: chosen from the JSON view, the code shows first
  // and the caret moves once the editor is on screen again.
  const [requestedProblem, setRequestedProblem] = useState<{
    line: number;
    column: number;
  } | null>(null);
  const selectProblem = useCallback(
    (line: number, column: number) => {
      if (latest.current.shown === "code") {
        reveal(line, column);
        return;
      }
      setShown("code");
      setRequestedProblem({ line, column });
    },
    [reveal],
  );
  useEffect(() => {
    if (showsJson || !requestedProblem) return;
    // Hidden, the editor measured 0×0; measure the shown pane before centering.
    editor.current?.layout();
    reveal(requestedProblem.line, requestedProblem.column);
    setRequestedProblem(null);
  }, [showsJson, requestedProblem, editor, reveal]);

  return (
    <div className="code-studio">
      <StudioLibrary
        ruleId={rule.id}
        definition={definition}
        source={source}
        functions={functions}
        catalogError={catalogError}
        formulaError={formulaError}
        readOnly={readOnly || showsJson}
        onInsert={insert}
        onBeginInsert={beginInsert}
        onInsertFormula={insertFormula}
      />
      <div className="studio-editor">
        <div className="studio-filebar">
          <span>
            <Code2 size={16} />
            {rule.id}.{showsJson ? "json" : "arc"}{" "}
            <small>{fileStatus(shown, pending)}</small>
          </span>
          <div>
            <ToggleButtonGroup
              size="small"
              exclusive
              value={shown}
              aria-label="Show the rule as"
              onChange={(_, value: Shown | null) => {
                if (value) setShown(value);
              }}
            >
              <ToggleButton value="code">Code</ToggleButton>
              <ToggleButton value="json">JSON</ToggleButton>
            </ToggleButtonGroup>
            <Button
              size="small"
              onClick={() => void onBuild()}
              startIcon={<Check size={14} />}
            >
              Build graph
            </Button>
          </div>
        </div>
        {!showsJson && <ExpressionColorKey />}
        <MonacoEditor
          wrapperProps={showsJson ? hiddenEditor : undefined}
          language={arcScriptLanguage}
          theme="arc-light"
          defaultValue={source}
          onChange={(value) => {
            // An adoption echoes the document's own text; only typing reports.
            if (!adopting.current) onChange(value ?? "");
          }}
          onMount={mount}
          options={options}
        />
        {showsJson && (
          <RuleJsonView
            ref={jsonView}
            definition={definition}
            onMount={addCommands}
          />
        )}
        <StudioProblems
          diagnostics={diagnostics}
          hint={editorHint(shown, readOnly)}
          onSelect={selectProblem}
        />
      </div>
      <StudioOutline definition={definition} onSelect={selectNode} />
    </div>
  );
}

/**
 * The file bar's note: whether the graph holds the code, or how current the
 * JSON is.
 */
function fileStatus(shown: Shown, pending: boolean): string {
  if (shown === "code") return pending ? "● edited" : "✓ graph synced";
  return pending ? "● edited · build to update" : "read-only";
}

/** What the shown editor offers, under it, while the code has no problems. */
function editorHint(shown: Shown, readOnly: boolean): string {
  if (readOnly) return "Read-only · ⌘/Ctrl Enter to validate";
  if (shown === "json")
    return "Rule JSON as stored · ⌘/Ctrl Enter to build · ⌘/Ctrl S to save";
  return "Tab to indent · ⌘/Ctrl Enter to build · ⌘/Ctrl S to save · comments use //";
}
