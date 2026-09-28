import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor/editor/editor.api";
import "monaco-editor/features/register.all";
// Monaco's all-features entry registers viewport tokens, but not document tokens.
import "monaco-editor/editor/contrib/semanticTokens/browser/documentSemanticTokens";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";
import { inputTypes } from "../../domain/inputTypes";
import { nodeTypes } from "../../domain/nodeKinds";

/**
 * Node kinds and input types, highlighted as type names in ARC Script. The
 * server reads a declaration's type in any case, and Monarch has no per-rule
 * flags, so every spelling of an input type is listed.
 */
const typeNames = [...nodeTypes, ...inputTypes.flatMap(caseSpellings)];

/** Each letter of `name` in either case: "NUMBER" -> NUMBER, number, Number and every mix. */
function caseSpellings(name: string): string[] {
  return [...name].reduce<string[]>(
    (spellings, letter) =>
      spellings.flatMap((prefix) => [
        prefix + letter.toUpperCase(),
        prefix + letter.toLowerCase(),
      ]),
    [""],
  );
}

self.MonacoEnvironment = { getWorker: () => new EditorWorker() };
loader.config({ monaco });
monaco.languages.register({ id: "arc" });
monaco.languages.setLanguageConfiguration("arc", {
  wordPattern: /@[a-z][a-z0-9-]*(?::[1-9]\d*)?|\$?[A-Za-z_][\w.]*/g,
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
  keywords: [
    "schema",
    "inputs",
    "node",
    "at",
    "let",
    "when",
    "select",
    "case",
    "equals",
    "field",
    "return",
    "use",
    "version",
    "bind",
    "as",
    "next",
    "edge",
    "source",
    "required",
    "optional",
    "default",
  ],
  typeNames,
  constants: ["true", "false", "null"],
  tokenizer: {
    root: [
      [/\/\/.*$/, "comment"],
      [/"/, "string", "@doubleQuotedString"],
      [/'/, "string", "@singleQuotedString"],
      [/@[a-z][a-z0-9-]*(?::[1-9]\d*)?/, "formula"],
      [/\$[A-Za-z_][\w.]*/, "function"],
      [/[A-Za-z_][\w.]*(?=\s*\()/, "function"],
      // One token per name or dotted path. Monarch retries an unmatched position
      // one character on, where \b-bounded word lists matched keywords inside
      // words: the "at" of order.format, the "let" of order.wallet.
      [
        /[A-Za-z_]\w*(?:\.\w+)*/,
        {
          cases: {
            "@keywords": "keyword",
            "@typeNames": "type",
            "@constants": "constant",
            "@default": "identifier",
          },
        },
      ],
      [/\d+(\.\d+)?/, "number"],
      [/[{}()[\]]/, "@brackets"],
      [/[+\-*/=><!&|^]+/, "operator"],
    ],
    doubleQuotedString: [
      [/[^"\\]+/, "string"],
      [/\\./, "string"],
      [/\\/, "string"],
      [/"/, "string", "@pop"],
    ],
    singleQuotedString: [
      [/[^'\\]+/, "string"],
      [/\\./, "string"],
      [/\\/, "string"],
      [/'/, "string", "@pop"],
    ],
  },
});
/**
 * A design token's hex color (tokens.css). This module loads lazily, after
 * index.css, so the tokens are resolved; a missing token is a build mistake
 * and fails here rather than painting black.
 */
function tokenColor(name: string): string {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  if (!/^#[0-9a-f]{6}$/i.test(value))
    throw new Error(`${name} is not a hex color token: "${value}"`);
  return value;
}

// The symbol roles and the editor background share their colors with the
// color key, the Available variables list and the code panels through tokens.
monaco.editor.defineTheme("arc-light", {
  base: "vs",
  inherit: true,
  rules: [
    { token: "keyword", foreground: "875295" },
    { token: "type", foreground: "327966" },
    {
      token: "function",
      foreground: tokenColor("--color-symbol-function").slice(1),
    },
    {
      token: "formula",
      foreground: tokenColor("--color-symbol-formula").slice(1),
    },
    {
      token: "parameter",
      foreground: tokenColor("--color-symbol-parameter").slice(1),
    },
    {
      token: "variable",
      foreground: tokenColor("--color-symbol-result").slice(1),
    },
    { token: "variable.local", foreground: "52665D" },
    { token: "comment", foreground: "8C9792" },
    { token: "string", foreground: "277B61" },
  ],
  colors: {
    "editor.background": tokenColor("--color-code-background"),
    "editorLineNumber.foreground": "#a5b1aa",
    "editor.lineHighlightBackground": "#f2f6f3",
    "editor.selectionBackground": "#dbece2",
  },
});

export { monaco };
