import { useEffect, useState } from "react";
import MonacoEditor from "@monaco-editor/react";
import { monaco } from "../studio/arcLanguage";
import { arcEditorOptions } from "../studio/useArcEditor";

const language = "arc-input-json";
monaco.languages.register({ id: language });
monaco.languages.setLanguageConfiguration(language, {
  brackets: [
    ["{", "}"],
    ["[", "]"],
  ],
  autoClosingPairs: [
    { open: '"', close: '"', notIn: ["string"] },
    { open: "{", close: "}" },
    { open: "[", close: "]" },
  ],
  indentationRules: {
    increaseIndentPattern: /^.*[\[{]\s*$/,
    decreaseIndentPattern: /^\s*[\]}]/,
  },
});
monaco.languages.setMonarchTokensProvider(language, {
  tokenizer: {
    root: [
      [/"([^"\\]|\\.)*"/, "string"],
      [/\b(true|false|null)\b/, "keyword"],
      [/-?\d+(\.\d+)?([eE][+-]?\d+)?/, "number"],
      [/[{}[\]]/, "@brackets"],
      [/[,:]/, "delimiter"],
    ],
  },
});

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

  return (
    <div className="execution-json-editor">
      <MonacoEditor
        language={language}
        theme="arc-light"
        value={value}
        onChange={(text) => onChange(text ?? "")}
        onMount={setEditor}
        options={{
          ...arcEditorOptions,
          ariaLabel: label,
          lineNumbersMinChars: 3,
          lineHeight: 20,
          folding: false,
          glyphMargin: false,
          renderLineHighlight: "none",
          lineDecorationsWidth: 6,
          padding: { top: 10, bottom: 10 },
          quickSuggestions: false,
          wordBasedSuggestions: "off",
          tabCompletion: "off",
        }}
      />
    </div>
  );
}
