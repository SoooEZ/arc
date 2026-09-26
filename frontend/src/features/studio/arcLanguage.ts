import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor/editor/editor.api";
import "monaco-editor/features/register.all";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";

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
      [/"([^"\\]|\\.)*("|$)|'([^'\\]|\\.)*('|$)/, "string"],
      [
        /\b(schema|inputs|node|at|let|when|select|case|equals|field|return|use|version|bind|as|next|edge|source|required|optional|default)\b/,
        "keyword",
      ],
      [
        /\b(INPUT|FORMULA|CONDITION|SWITCH|TRANSFORM|REFERENCE|OUTPUT|NUMBER|STRING|BOOLEAN|ARRAY|OBJECT)\b/,
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

export { monaco };
