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
