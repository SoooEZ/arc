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

test("frontend reserved names are the backend's Identifiers.RESERVED", () => {
  const words = (list) =>
    [...list.matchAll(/"([^"]+)"/g)].map(([, word]) => word).sort();
  const java = /RESERVED = Set\.of\(([^)]*)\)/.exec(
    read("backend/src/main/java/dev/arc/engine/Identifiers.java"),
  );
  assert.ok(java, "Identifiers.java declares RESERVED");
  const frontend = /const reserved = new Set\(\[([^\]]*)\]\)/.exec(
    read("frontend/src/domain/identifiers.ts"),
  );
  assert.ok(frontend, "identifiers.ts declares the reserved names");
  assert.deepEqual(words(frontend[1]), words(java[1]));
});

test("frontend timeout ranges are the server's", () => {
  const millis = (source, name) => {
    const match = new RegExp(`${name} = ([\\d_]+);`).exec(source);
    assert.ok(match, `${name} is declared`);
    return Number(match[1].replaceAll("_", ""));
  };
  // HTTP sources: HttpSourceAdapter refuses a timeout outside its range.
  const adapter = read(
    "backend/src/main/java/dev/arc/source/http/HttpSourceAdapter.java",
  );
  const sources = /httpTimeoutLimits = \{ min: ([\d_]+), max: ([\d_]+) \}/.exec(
    read("frontend/src/features/sources/sourceDocument.ts"),
  );
  assert.ok(sources, "sourceDocument.ts declares httpTimeoutLimits");
  assert.equal(
    Number(sources[1].replaceAll("_", "")),
    millis(adapter, "MIN_TIMEOUT_MS"),
  );
  assert.equal(
    Number(sources[2].replaceAll("_", "")),
    millis(adapter, "MAX_TIMEOUT_MS"),
  );
  // Executions: the options offer the server's default and nothing above its ceiling.
  const deadline = read(
    "backend/src/main/java/dev/arc/engine/ExecutionDeadline.java",
  );
  const options = read("frontend/src/features/execution/executionOptions.ts");
  const offered = /executionTimeoutChoicesMs = \[([^\]]*)\]/.exec(options);
  assert.ok(offered, "executionOptions.ts lists its timeout choices");
  const choices = offered[1]
    .split(",")
    .map((choice) => Number(choice.trim().replaceAll("_", "")));
  for (const choice of choices) {
    assert.ok(
      choice >= millis(deadline, "MIN_TIMEOUT_MS"),
      `${choice} ms is allowed`,
    );
    assert.ok(
      choice <= millis(deadline, "MAX_TIMEOUT_MS"),
      `${choice} ms is allowed`,
    );
  }
  const defaultTimeout = /timeoutMs: ([\d_]+),/.exec(options);
  assert.ok(defaultTimeout, "executionOptions.ts states the default timeout");
  assert.equal(
    Number(defaultTimeout[1].replaceAll("_", "")),
    millis(deadline, "DEFAULT_TIMEOUT_MS"),
  );
});
