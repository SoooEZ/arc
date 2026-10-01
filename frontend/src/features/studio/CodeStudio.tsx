import { useEffect, useRef } from "react";
import MonacoEditor from "@monaco-editor/react";
import { Button } from "@mui/material";
import { Check, Code2 } from "lucide-react";
import { arcScriptLanguage, monaco } from "./arcLanguage";
import type { Definition, Diagnostic, Rule } from "../../types";
import { useFunctionCatalog } from "./useFunctionCatalog";
import { useArcLanguageSupport, insertSnippet } from "./useArcLanguageSupport";
import { captureEditorState, unchangedSince } from "./arcCompletion";
import {
  adoptSource,
  codeStudioOptions,
  useArcEditor,
  useEditorOptions,
} from "./useArcEditor";
import StudioLibrary from "./StudioLibrary";
import StudioOutline from "./StudioOutline";
import StudioProblems from "./StudioProblems";
import ExpressionColorKey from "./ExpressionColorKey";
import { nodeDeclarationOffset } from "./scriptOutline";

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
  const { data: functions, error: catalogError } = useFunctionCatalog();
  const latest = useRef({ onBuild, onSave, readOnly });
  latest.current = { onBuild, onSave, readOnly };
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
  const insert = (snippet: string, atEnd = false) => {
    if (!latest.current.readOnly) insertSnippet(editor.current, snippet, atEnd);
  };
  /**
   * An insertion that starts with a read: the returned function inserts only
   * while the code and the selection are as they were when the read started,
   * the rule Formula insertion applies (lesson F3).
   */
  const beginInsert = () => {
    const state = captureEditorState(editor.current);
    return (snippet: string, atEnd = false) => {
      if (latest.current.readOnly) return;
      if (!unchangedSince(editor.current, state))
        throw new Error(
          "The code changed while the rule loaded. Choose the rule again.",
        );
      insertSnippet(editor.current, snippet, atEnd);
    };
  };
  const { insertFormula, formulaError } = useArcLanguageSupport(
    editor,
    model,
    functions,
    { kind: "script", definition },
  );

  const mount = (instance: monaco.editor.IStandaloneCodeEditor) => {
    onMount(instance);
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
  const selectNode = (nodeId: string) => {
    const model = editor.current?.getModel();
    if (!model) return;
    const offset = nodeDeclarationOffset(model.getValue(), nodeId);
    if (offset === null) return;
    const declaration = model.getPositionAt(offset);
    reveal(declaration.lineNumber, declaration.column);
  };

  return (
    <div className="code-studio">
      <StudioLibrary
        ruleId={rule.id}
        definition={definition}
        source={source}
        functions={functions}
        catalogError={catalogError}
        formulaError={formulaError}
        readOnly={readOnly}
        onInsert={insert}
        onBeginInsert={beginInsert}
        onInsertFormula={insertFormula}
      />
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
          </div>
        </div>
        <ExpressionColorKey />
        <MonacoEditor
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
        <StudioProblems
          diagnostics={diagnostics}
          readOnly={readOnly}
          onSelect={reveal}
        />
      </div>
      <StudioOutline definition={definition} onSelect={selectNode} />
    </div>
  );
}
