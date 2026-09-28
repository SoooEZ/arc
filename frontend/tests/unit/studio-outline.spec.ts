import { expect, test } from "@playwright/test";
import { nodeDeclarationOffset } from "../../src/features/studio/scriptOutline";

/** The line of the located declaration, for readable failures. */
function declarationLine(source: string, nodeId: string): string | null {
  const offset = nodeDeclarationOffset(source, nodeId);
  if (offset === null) return null;
  const end = source.indexOf("\n", offset);
  return source.slice(offset, end === -1 ? undefined : end);
}

// The canonical renderer hoists notes above every node declaration.
const canonical = [
  "schema 1;",
  "",
  '// node "calc" is legacy; keep until Q3',
  "inputs {",
  '  label: STRING required default "node \\"calc\\" {";',
  "}",
  "",
  'node "Output" OUTPUT "Upper" at (0.0, 0.0) {',
  "  return 'node \"output\"';",
  "}",
  "",
  'node "output" OUTPUT "Lower" at (0.0, 100.0) {',
  "  return 2;",
  "}",
  "",
  'node "calc2" FORMULA "Prefix" at (0.0, 200.0) {',
  "  let total = 1;",
  "}",
  "",
  'node "calc" FORMULA "Calc" at (0.0, 300.0) {',
  "  let other = 1;",
  "}",
].join("\n");

test("node IDs that differ only by case locate their own declarations", () => {
  expect(declarationLine(canonical, "output")).toBe(
    'node "output" OUTPUT "Lower" at (0.0, 100.0) {',
  );
  expect(declarationLine(canonical, "Output")).toBe(
    'node "Output" OUTPUT "Upper" at (0.0, 0.0) {',
  );
  expect(nodeDeclarationOffset(canonical, "OUTPUT")).toBeNull();
});

test("comments, strings and ID prefixes never count as declarations", () => {
  expect(declarationLine(canonical, "calc")).toBe(
    'node "calc" FORMULA "Calc" at (0.0, 300.0) {',
  );
  expect(declarationLine(canonical, "calc2")).toBe(
    'node "calc2" FORMULA "Prefix" at (0.0, 200.0) {',
  );
  expect(nodeDeclarationOffset(canonical, "missing")).toBeNull();
});

test("hand-written headers: bare and hyphenated IDs, keyword case, escapes and shared lines", () => {
  const source = [
    'NODE start INPUT "Start" { next -> my-node; }',
    'node my-node FORMULA "Hyphenated" { let a = 1; next -> end; }',
    'schema 1; node "c\\u0061lc" OUTPUT "Escaped" { return a; }',
    'node end OUTPUT "End" { return "}"; } node after OUTPUT "After" { return 1; }',
  ].join("\n");
  expect(declarationLine(source, "start")).toBe(
    'NODE start INPUT "Start" { next -> my-node; }',
  );
  expect(declarationLine(source, "my-node")).toBe(
    'node my-node FORMULA "Hyphenated" { let a = 1; next -> end; }',
  );
  expect(declarationLine(source, "calc")).toBe(
    'node "c\\u0061lc" OUTPUT "Escaped" { return a; }',
  );
  expect(declarationLine(source, "after")).toBe(
    'node after OUTPUT "After" { return 1; }',
  );
  // `next -> end;` inside a body is not a declaration of end.
  expect(declarationLine(source, "end")).toBe(
    'node end OUTPUT "End" { return "}"; } node after OUTPUT "After" { return 1; }',
  );
});

test("unfinished text never throws and finds nothing after an open string or comment", () => {
  expect(nodeDeclarationOffset('node "calc', "calc")).toBeNull();
  expect(
    nodeDeclarationOffset('let x = "open\nnode "calc" X "Y" {', "calc"),
  ).toBeNull();
  expect(nodeDeclarationOffset('// node "calc" X "Y" {', "calc")).toBeNull();
  expect(nodeDeclarationOffset('node "calc" X "Y" {', "calc")).toBe(0);
});
