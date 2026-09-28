import { expect, test } from "@playwright/test";
import ts from "typescript";
import { readRepositoryFile, repositoryFiles } from "../helpers/repository";

/**
 * A conditional expression nested in another's branch, reported as
 * `file:line`. A function body, a block and a JSX element start a new context:
 * a callback or an element rendered inside a branch makes its own decisions.
 * (frontend/AGENTS.md: avoid nested ternaries.)
 */
function nestedTernaries(file: string, text: string): string[] {
  const source = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const found: string[] = [];
  const visit = (node: ts.Node, insideBranch: boolean) => {
    if (ts.isConditionalExpression(node)) {
      if (insideBranch) {
        const { line } = source.getLineAndCharacterOfPosition(node.getStart());
        found.push(`${file}:${line + 1}`);
      }
      visit(node.condition, insideBranch);
      visit(node.whenTrue, true);
      visit(node.whenFalse, true);
      return;
    }
    const resets =
      ts.isFunctionLike(node) ||
      ts.isClassLike(node) ||
      ts.isBlock(node) ||
      ts.isJsxElement(node) ||
      ts.isJsxSelfClosingElement(node) ||
      ts.isJsxFragment(node);
    ts.forEachChild(node, (child) => visit(child, insideBranch && !resets));
  };
  visit(source, false);
  return found;
}

test("the frontend source nests no conditional expression inside another's branch", () => {
  const violations = repositoryFiles("frontend/src", [".ts", ".tsx"]).flatMap(
    (file) => nestedTernaries(file, readRepositoryFile(file)),
  );
  expect(violations).toEqual([]);
});

test("the scan reports a nested ternary and lets a callback in a branch pass", () => {
  expect(
    nestedTernaries(
      "probe.ts",
      "const a = x ? (y ? 1 : 2) : 3;\nconst b = x ? 1 : y ? 2 : 3;",
    ),
  ).toEqual(["probe.ts:1", "probe.ts:2"]);
  expect(
    nestedTernaries(
      "probe.ts",
      "const c = x ? items.map((item) => (item ? 1 : 2)) : [];",
    ),
  ).toEqual([]);
});

/**
 * Browser specs create, publish and delete rules through tests/helpers/api,
 * and make IDs unique with its `uniqueId`/`uniqueStamp`: one place carries
 * the request shape, the refusal text and the 80-character slug policy.
 */
const directRuleCalls = [
  /request\.post\("\/api\/rules"/,
  /request\.post\(`\/api\/rules\/[^`]*\/publish`/,
  /request\.delete\(`\/api\/rules\//,
  /Date\.now\(\)/,
];

test("browser specs reach the rule API and unique IDs through the shared helpers", () => {
  const violations = repositoryFiles("frontend/tests", [".spec.ts"]).flatMap(
    (file) => {
      const lines = readRepositoryFile(file).split("\n");
      return lines.flatMap((line, index) =>
        directRuleCalls.some((pattern) => pattern.test(line))
          ? [`${file}:${index + 1}`]
          : [],
      );
    },
  );
  expect(violations).toEqual([]);
});

/** The name a declaration statement binds, or null for one that binds none (or several). */
function declaredName(statement: ts.Statement): string | null {
  if (
    (ts.isFunctionDeclaration(statement) ||
      ts.isClassDeclaration(statement) ||
      ts.isInterfaceDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement) ||
      ts.isEnumDeclaration(statement)) &&
    statement.name
  )
    return statement.name.text;
  return null;
}

/** The names a module exports, with `default` for its default export. */
function exportedNames(file: string, text: string): string[] {
  const source = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const names: string[] = [];
  const hasModifier = (node: ts.Statement, kind: ts.SyntaxKind) =>
    ts.canHaveModifiers(node) &&
    !!ts.getModifiers(node)?.some((modifier) => modifier.kind === kind);
  for (const statement of source.statements) {
    if (ts.isExportAssignment(statement)) names.push("default");
    else if (ts.isExportDeclaration(statement)) {
      const clause = statement.exportClause;
      if (clause && ts.isNamedExports(clause))
        for (const element of clause.elements) names.push(element.name.text);
    } else if (hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
      if (hasModifier(statement, ts.SyntaxKind.DefaultKeyword))
        names.push("default");
      else if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations)
          if (ts.isIdentifier(declaration.name))
            names.push(declaration.name.text);
      } else if (
        !ts.isInterfaceDeclaration(statement) &&
        !ts.isTypeAliasDeclaration(statement)
      ) {
        // A type exported for a signature is used through that signature.
        const name = declaredName(statement);
        if (name) names.push(name);
      }
    }
  }
  return names;
}

test("every value the frontend source exports is used by another module or a test", () => {
  const allSources = repositoryFiles("frontend/src", [".ts", ".tsx"]);
  const sources = allSources.filter(
    (file) => !file.endsWith("main.tsx") && !file.endsWith(".d.ts"),
  );
  const texts = new Map(
    [...allSources, ...repositoryFiles("frontend/tests", [".ts"])].map(
      (file) => [file, readRepositoryFile(file)],
    ),
  );
  const mentionedElsewhere = (file: string, name: string) => {
    const word = new RegExp(`\\b${name}\\b`);
    for (const [other, text] of texts)
      if (other !== file && word.test(text)) return true;
    return false;
  };
  const unused: string[] = [];
  for (const file of sources)
    for (const name of exportedNames(file, texts.get(file)!)) {
      // A default export is reached through its module's name.
      const needle =
        name === "default"
          ? file.replace(/^.*\//, "").replace(/\.tsx?$/, "")
          : name;
      if (!mentionedElsewhere(file, needle)) unused.push(`${file}: ${name}`);
    }
  expect(unused).toEqual([]);
});

test("the export scan reads named values, defaults and re-exported names", () => {
  expect(
    exportedNames(
      "probe.ts",
      [
        "export const a = 1, b = 2;",
        "export function c() {}",
        "export class D {}",
        "export interface E {}",
        "export type F = string;",
        "export { g, h as i } from './other';",
        "export default function j() {}",
        "const k = 1;",
      ].join("\n"),
    ),
  ).toEqual(["a", "b", "c", "D", "g", "i", "default"]);
});
