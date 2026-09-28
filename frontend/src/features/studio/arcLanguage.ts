import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor/editor/editor.api";
import "monaco-editor/features/register.all";
// Monaco's all-features entry registers viewport tokens, but not document tokens.
import "monaco-editor/editor/contrib/semanticTokens/browser/documentSemanticTokens";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";
import { inputTypes } from "../../domain/inputTypes";
import { parseCssColor } from "./cssColor";
import { nodeTypes } from "../../domain/nodeKinds";

/**
 * Node kinds, highlighted as type names where a node is declared. Input types
 * are highlighted only after the colon of a declaration: the server reads them
 * in any case, and Monarch has no per-rule flags, so every spelling is listed.
 */
const typeNames = [...nodeTypes];
const inputTypeNames = inputTypes.flatMap(caseSpellings);

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
  inputTypeNames,
  constants: ["true", "false", "null"],
  tokenizer: {
    root: [
      [/\/\/.*$/, "comment"],
      [/"/, "string", "@doubleQuotedString"],
      [/'/, "string", "@singleQuotedString"],
      [/@[a-z][a-z0-9-]*(?::[1-9]\d*)?/, "formula"],
      [/\$[A-Za-z_][\w.]*/, "function"],
      // A declared type follows the colon of `name: TYPE`; an identifier named
      // like a type elsewhere keeps its own color.
      [
        /(:)(\s*)([A-Za-z_]\w*)/,
        [
          "operator",
          "white",
          { cases: { "@inputTypeNames": "type", "@default": "identifier" } },
        ],
      ],
      // A keyword before a parenthesis stays a keyword: `at (x, y)`, `when (…)`.
      [
        /[A-Za-z_][\w.]*(?=\s*\()/,
        { cases: { "@keywords": "keyword", "@default": "function" } },
      ],
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
 * A design token's color (tokens.css) as `#rrggbb`. This module loads lazily,
 * after index.css, so the tokens are resolved. A token that is missing or
 * spelled in a way Monaco cannot take is a build mistake: it is reported once
 * and the given fallback paints instead, so the studio still opens.
 */
function tokenColor(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(
    name,
  );
  const color = parseCssColor(value);
  if (color) return color;
  console.warn(
    `${name} is not a color token Monaco can use ("${value.trim()}"); painting ${fallback}`,
  );
  return fallback;
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
      foreground: tokenColor("--color-symbol-function", "#8b682f").slice(1),
    },
    {
      token: "formula",
      foreground: tokenColor("--color-symbol-formula", "#007c83").slice(1),
    },
    {
      token: "parameter",
      foreground: tokenColor("--color-symbol-parameter", "#205fa6").slice(1),
    },
    {
      token: "variable",
      foreground: tokenColor("--color-symbol-result", "#7b3f98").slice(1),
    },
    { token: "variable.local", foreground: "52665D" },
    { token: "comment", foreground: "8C9792" },
    { token: "string", foreground: "277B61" },
  ],
  colors: {
    "editor.background": tokenColor("--color-code-background", "#fcfdfc"),
    "editorLineNumber.foreground": "#a5b1aa",
    "editor.lineHighlightBackground": "#f2f6f3",
    "editor.selectionBackground": "#dbece2",
  },
});

export { monaco };
