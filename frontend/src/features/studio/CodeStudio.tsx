import { useRef } from "react";
import MonacoEditor from "@monaco-editor/react";
import { Button } from "@mui/material";
import { Check, Code2, GitBranch } from "lucide-react";
import { monaco } from "./arcLanguage";
import { studioApi } from "../../api/studio";
import type { Definition, Diagnostic, FunctionEntry, Rule } from "../../types";
import { useAsyncResource } from "../../hooks/useAsyncResource";
import { useArcLanguageSupport, insertSnippet } from "./useArcLanguageSupport";
import { useArcEditor, arcEditorOptions } from "./useArcEditor";
import StudioLibrary from "./StudioLibrary";
import StudioOutline from "./StudioOutline";
import StudioProblems from "./StudioProblems";
import ExpressionColorKey from "./ExpressionColorKey";

interface Props {
  rule: Rule;
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
  const { editor, model, onMount, reveal } = useArcEditor(diagnostics);
  const { data: functions, error: catalogError } = useAsyncResource(
    "functions",
    (signal) => studioApi.functions({ signal }),
    [] as FunctionEntry[],
  );
  const latest = useRef({ onBuild, onSave, readOnly });
  latest.current = { onBuild, onSave, readOnly };
  const insert = (snippet: string, atEnd = false) => {
    if (!latest.current.readOnly) insertSnippet(editor.current, snippet, atEnd);
  };
  useArcLanguageSupport(editor, model, functions, definition);

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
    const match =
      model?.findMatches(
        `node "${nodeId}"`,
        false,
        false,
        false,
        null,
        false,
      )[0] ||
      model?.findMatches(
        `node ${nodeId} `,
        false,
        false,
        false,
        null,
        false,
      )[0];
    if (match) reveal(match.range.startLineNumber);
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
            <Button
              size="small"
              onClick={onGraph}
              startIcon={<GitBranch size={14} />}
            >
              Open graph
            </Button>
          </div>
        </div>
        <ExpressionColorKey />
        <MonacoEditor
          language="arc"
          theme="arc-light"
          value={source}
          onChange={(value) => onChange(value ?? "")}
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
