import { useEffect, useState } from "react";
import MonacoEditor from "@monaco-editor/react";
import { monaco } from "../studio/arcLanguage";
import { jsonLanguage } from "../studio/jsonLanguage";
import { jsonInputOptions, useEditorOptions } from "../studio/useArcEditor";

export default function InputJsonEditor({
  value,
  onChange,
  label,
  focusRequest = 0,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  focusRequest?: number;
}) {
  const [editor, setEditor] =
    useState<monaco.editor.IStandaloneCodeEditor | null>(null);
  useEffect(() => {
    if (focusRequest > 0) editor?.focus();
  }, [editor, focusRequest]);
  const options = useEditorOptions(jsonInputOptions, false, label);

  return (
    <div className="execution-json-editor">
      <MonacoEditor
        language={jsonLanguage}
        theme="arc-light"
        value={value}
        onChange={(text) => onChange(text ?? "")}
        onMount={setEditor}
        options={options}
      />
    </div>
  );
}
