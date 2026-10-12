import { monaco } from "./arcLanguage";

/**
 * JSON colored by the editors that show it: the Test panel's input and the
 * code view's rule JSON. The Monaco build bundles no JSON language of its own.
 */
export const jsonLanguage = "arc-json";

monaco.languages.register({ id: jsonLanguage });
monaco.languages.setLanguageConfiguration(jsonLanguage, {
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
monaco.languages.setMonarchTokensProvider(jsonLanguage, {
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
