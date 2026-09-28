import { useEffect, useRef } from "react";
import MonacoEditor from "@monaco-editor/react";
import { Button } from "@mui/material";
import { Check, Code2 } from "lucide-react";
import { monaco } from "./arcLanguage";
import type { Definition, Diagnostic, Rule } from "../../types";
import { useFunctionCatalog } from "./useFunctionCatalog";
import { useArcLanguageSupport, insertSnippet } from "./useArcLanguageSupport";
import { adoptSource, useArcEditor, arcEditorOptions } from "./useArcEditor";
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
  const { insertFormula } = useArcLanguageSupport(editor, model, functions, {
    kind: "script",
    definition,
  });

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
      precondition: "!editorReadonly",
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
        functions={functions}
        catalogError={catalogError}
        readOnly={readOnly}
        onInsert={insert}
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
          language="arc"
          theme="arc-light"
          defaultValue={source}
          onChange={(value) => {
            // An adoption echoes the document's own text; only typing reports.
            if (!adopting.current) onChange(value ?? "");
          }}
          onMount={mount}
          options={{
            ...arcEditorOptions,
            readOnly,
            lineHeight: 23,
            minimap: { enabled: true },
            padding: { top: 20, bottom: 20 },
            ariaLabel: "ARC code editor",
          }}
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
