// Frontend facts that mirror a backend or documentation source of truth.
// The browser restates a few server constants and lists so it can refuse what
// the server would reject; these tests fail when a mirror drifts.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFileSync(path.join(root, relative), "utf8");

test("frontend limits carry the values of backend Limits.java", () => {
  const java = read("backend/src/main/java/dev/arc/engine/Limits.java");
  const javaValues = new Map(
    [...java.matchAll(/public static final int (\w+) = ([\d_]+);/g)].map(
      ([, name, value]) => [name, Number(value.replaceAll("_", ""))],
    ),
  );
  const mirrored = [
    ...read("frontend/src/domain/limits.ts").matchAll(
      /^export const (MAX_\w+) = ([\d_]+);/gm,
    ),
  ];
  assert.ok(mirrored.length >= 10, "limits.ts lists the mirrored constants");
  for (const [, name, value] of mirrored) {
    assert.ok(javaValues.has(name), `Limits.java declares ${name}`);
    assert.equal(
      Number(value.replaceAll("_", "")),
      javaValues.get(name),
      `${name} matches Limits.java`,
    );
  }
});

test("frontend input types list the backend InputTypes.Type constants", () => {
  const java = read("backend/src/main/java/dev/arc/engine/InputTypes.java");
  const constants = /enum Type \{\s*([A-Z_,\s]+);/.exec(java);
  assert.ok(constants, "InputTypes.java declares the Type constants");
  const javaNames = constants[1].split(",").map((name) => name.trim());
  const facts = /inputTypeFacts[^=]*= \{(.*?)\n\};/s.exec(
    read("frontend/src/domain/inputTypes.ts"),
  );
  assert.ok(facts, "inputTypes.ts declares inputTypeFacts");
  const frontendNames = [...facts[1].matchAll(/^\s+(\w+): \{/gm)].map(
    ([, name]) => name,
  );
  assert.deepEqual(frontendNames, javaNames);
});

test("the in-app API reference lists real operations and every /rules operation", () => {
  const spec = read("docs/openapi.yaml");
  const operations = new Set();
  let currentPath = null;
  for (const line of spec.split("\n")) {
    const pathLine = /^  (\/\S*):\s*$/.exec(line);
    if (pathLine) currentPath = pathLine[1];
    const methodLine = /^    (get|post|put|delete|patch):\s*$/.exec(line);
    if (currentPath && methodLine)
      operations.add(`${methodLine[1].toUpperCase()} ${currentPath}`);
  }
  assert.ok(operations.size > 10, "the spec lists its operations");
  const listed = JSON.parse(
    read("frontend/src/features/execution/apiEndpoints.json"),
  );
  for (const { method, path: endpoint } of listed)
    assert.ok(
      operations.has(`${method} ${endpoint}`),
      `${method} ${endpoint} exists in docs/openapi.yaml`,
    );
  const listedKeys = new Set(listed.map((row) => `${row.method} ${row.path}`));
  for (const operation of operations)
    if (/ \/rules(\/\{id\})?$/.test(operation))
      assert.ok(listedKeys.has(operation), `${operation} is listed`);
});
