// The frontend's only lint: the React hooks rules. Prettier owns formatting and
// the TypeScript compiler the types; this catches what neither does, a hook
// called conditionally or an effect that omits a value it reads (the gap the
// 2026-10-11 review found in useRuleDocument). The TypeScript parser is needed
// because ESLint's default parser cannot read TypeScript or JSX.
import tsParser from "@typescript-eslint/parser";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2024,
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
    },
  },
];
