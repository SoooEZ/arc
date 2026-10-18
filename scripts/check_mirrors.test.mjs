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

test("the secret header limit of HTTP sources matches HttpDestinationPolicy", () => {
  const java = /MAX_SECRET_HEADERS = (\d+);/.exec(
    read(
      "backend/src/main/java/dev/arc/source/http/HttpDestinationPolicy.java",
    ),
  );
  const frontend = /export const MAX_SECRET_HEADERS = (\d+);/.exec(
    read("frontend/src/features/sources/httpSourcePolicy.ts"),
  );
  assert.ok(java, "HttpDestinationPolicy.java declares MAX_SECRET_HEADERS");
  assert.ok(frontend, "httpSourcePolicy.ts declares MAX_SECRET_HEADERS");
  assert.equal(Number(frontend[1]), Number(java[1]));
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

/** Every "METHOD /path" docs/openapi.yaml documents. */
function specOperations() {
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
  return operations;
}

test("the in-app API reference lists real operations and every /rules operation", () => {
  const operations = specOperations();
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

/** The value of a `NAME = digits;` declaration in a Java or TypeScript source. */
const declaredInt = (source, name) => {
  const match = new RegExp(`${name} = ([\\d_]+);`).exec(source);
  assert.ok(match, `${name} is declared`);
  return Number(match[1].replaceAll("_", ""));
};

test("frontend timeout ranges and the URL bound are the server's", () => {
  const policy = read("frontend/src/features/sources/httpSourcePolicy.ts");
  // HTTP sources: HttpSourceAdapter refuses a timeout outside its range.
  const adapter = read(
    "backend/src/main/java/dev/arc/source/http/HttpSourceAdapter.java",
  );
  const sources = /httpTimeoutLimits = \{ min: ([\d_]+), max: ([\d_]+) \}/.exec(
    policy,
  );
  assert.ok(sources, "httpSourcePolicy.ts declares httpTimeoutLimits");
  assert.equal(
    Number(sources[1].replaceAll("_", "")),
    declaredInt(adapter, "MIN_TIMEOUT_MS"),
  );
  assert.equal(
    Number(sources[2].replaceAll("_", "")),
    declaredInt(adapter, "MAX_TIMEOUT_MS"),
  );
  // HTTP URLs: HttpDestinationPolicy refuses a URL longer than its bound.
  const destinations = read(
    "backend/src/main/java/dev/arc/source/http/HttpDestinationPolicy.java",
  );
  assert.equal(
    declaredInt(policy, "MAX_URL_CHARACTERS"),
    declaredInt(destinations, "MAX_URL_CHARACTERS"),
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
      choice >= declaredInt(deadline, "MIN_TIMEOUT_MS"),
      `${choice} ms is allowed`,
    );
    assert.ok(
      choice <= declaredInt(deadline, "MAX_TIMEOUT_MS"),
      `${choice} ms is allowed`,
    );
  }
  const defaultTimeout = /timeoutMs: ([\d_]+),/.exec(options);
  assert.ok(defaultTimeout, "executionOptions.ts states the default timeout");
  assert.equal(
    Number(defaultTimeout[1].replaceAll("_", "")),
    declaredInt(deadline, "DEFAULT_TIMEOUT_MS"),
  );
});

test("frontend Formula references follow the server's ID and version grammar", () => {
  // Identifiers.RESOURCE_ID: the pattern around the length limit, as written.
  const javaId =
    /RESOURCE_ID =\s*Pattern\.compile\("([^"]*)" \+ \(Limits\.MAX_RESOURCE_ID_CHARACTERS - 1\) \+ "([^"]*)"\)/.exec(
      read("backend/src/main/java/dev/arc/engine/Identifiers.java"),
    );
  assert.ok(javaId, "Identifiers.java builds RESOURCE_ID around the limit");
  const frontendId =
    /export const resourceIdSyntax = `([^`]*)\$\{MAX_RESOURCE_ID_CHARACTERS - 1\}([^`]*)`;/.exec(
      read("frontend/src/domain/resourceIds.ts"),
    );
  assert.ok(frontendId, "resourceIds.ts builds resourceIdSyntax around the limit");
  assert.deepEqual([frontendId[1], frontendId[2]], [javaId[1], javaId[2]]);
  // ExpressionParser.VERSION: digits without a leading zero.
  const javaVersion = /VERSION = Pattern\.compile\("([^"]*)"\)/.exec(
    read(
      "backend/src/main/java/dev/arc/engine/expression/ExpressionParser.java",
    ),
  );
  assert.ok(javaVersion, "ExpressionParser.java declares VERSION");
  const references = read("frontend/src/domain/formulaReferences.ts");
  const frontendVersion = /const versionSyntax = "([^"]*)";/.exec(references);
  assert.ok(frontendVersion, "formulaReferences.ts declares versionSyntax");
  assert.equal(frontendVersion[1], javaVersion[1]);
  // A version is served through an int path variable: nothing larger names one.
  assert.match(
    read("backend/src/main/java/dev/arc/api/RuleController.java"),
    /@PathVariable int version/,
  );
  assert.equal(declaredInt(references, "MAX_PUBLISHED_VERSION"), 2 ** 31 - 1);
});

/** Java source without its comments. */
const withoutComments = (java) =>
  java.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

/** The constants of a Java enum, in their order. */
function enumConstants(java, name) {
  const body = new RegExp(`enum ${name} \\{\\s*([A-Z_,\\s]+?)[;}]`).exec(
    withoutComments(java),
  );
  assert.ok(body, `${name} declares its constants`);
  return body[1]
    .split(",")
    .map((constant) => constant.trim())
    .filter(Boolean);
}

/** The quoted upper-case words of a list or union, in their order. */
const quotedWords = (text) =>
  [...text.matchAll(/"([A-Z_]+)"/g)].map(([, word]) => word);

test("node, rule and source kinds have one vocabulary across the frontend, the spec and the guard", () => {
  const nodeKindJava = read("backend/src/main/java/dev/arc/model/NodeKind.java");
  const nodeKinds = enumConstants(nodeKindJava, "NodeKind");
  const ruleKinds = enumConstants(
    read("backend/src/main/java/dev/arc/model/RuleKind.java"),
    "RuleKind",
  );
  const sourceKinds = ["lookup/LookupSourceAdapter", "http/HttpSourceAdapter"]
    .map((adapter) =>
      /public String kind\(\) \{\s*return "([A-Z_]+)";/.exec(
        read(`backend/src/main/java/dev/arc/source/${adapter}.java`),
      ),
    )
    .map((match) => {
      assert.ok(match, "every source adapter names its kind");
      return match[1];
    });
  // types.ts: the unions the editor compiles against.
  const types = read("frontend/src/types.ts");
  const union = (name) => {
    const match = new RegExp(`export type ${name} =([^;]*);`).exec(types);
    assert.ok(match, `types.ts declares ${name}`);
    return quotedWords(match[1]);
  };
  assert.deepEqual(union("NodeType"), nodeKinds);
  assert.deepEqual(union("Kind"), ruleKinds);
  const sourceKind = /interface SourceConfig \{[^}]*?kind: ([^;]*);/.exec(types);
  assert.ok(sourceKind, "types.ts declares SourceConfig.kind");
  assert.deepEqual(quotedWords(sourceKind[1]).sort(), [...sourceKinds].sort());
  // nodeKinds.ts: one entry per kind, with the properties NodeKind.declaredProperties() grants.
  const propertyNames = {
    EXPRESSION: "expression",
    OUTPUT: "output",
    RULE: "rule",
    BINDINGS: "bindings",
    SELECTOR: "selector",
    CASES: "cases",
    FIELDS: "fields",
    OUTPUT_NAME: "outputName",
  };
  assert.deepEqual(
    enumConstants(nodeKindJava, "Property"),
    Object.keys(propertyNames),
    "every NodeKind.Property has a frontend property name",
  );
  const declared = /declaredProperties\(\) \{\s*return switch \(this\) \{([\s\S]*?)\};/.exec(
    nodeKindJava,
  );
  assert.ok(declared, "NodeKind.java declares each kind's properties");
  const serverProperties = Object.fromEntries(
    [...declared[1].matchAll(/case ([A-Z_]+) -> Set\.of\(([^)]*)\)/g)].map(
      ([, kind, set]) => [
        kind,
        [...set.matchAll(/Property\.(\w+)/g)].map(([, name]) => propertyNames[name]),
      ],
    ),
  );
  const descriptors = [
    ...read("frontend/src/domain/nodeKinds.ts").matchAll(
      /\n  ([A-Z_]+): \{[\s\S]*?properties: \[([^\]]*)\]/g,
    ),
  ].map(([, kind, properties]) => [
    kind,
    [...properties.matchAll(/"(\w+)"/g)].map(([, name]) => name),
  ]);
  assert.deepEqual(
    descriptors.map(([kind]) => kind),
    nodeKinds,
    "nodeKinds.ts lists the kinds in the server's order",
  );
  assert.deepEqual(Object.fromEntries(descriptors), serverProperties);
  // docs/openapi.yaml: every enum that names a kind lists the whole vocabulary.
  const enums = [
    ...read("docs/openapi.yaml").matchAll(/enum: \[([A-Z_, ]+)\]/g),
  ].map(([, list]) => list.split(",").map((word) => word.trim()));
  const naming = (member) => {
    const lists = enums.filter((list) => list.includes(member));
    assert.ok(lists.length >= 1, `docs/openapi.yaml has an enum with ${member}`);
    return lists;
  };
  for (const list of naming("INPUT")) assert.deepEqual(list, nodeKinds);
  for (const list of naming("DECISION_TREE")) assert.deepEqual(list, ruleKinds);
  for (const list of naming("LOOKUP"))
    assert.deepEqual([...list].sort(), [...sourceKinds].sort());
  // The architecture guard's vocabulary and the style spec's kind list.
  const guard = /NODE_KINDS = \(([^)]*)\)/.exec(read("scripts/check_architecture.py"));
  assert.ok(guard, "check_architecture.py declares NODE_KINDS");
  assert.deepEqual(quotedWords(guard[1]), nodeKinds);
  const colors = /const kinds: NodeType\[\] = \[([^\]]*)\]/.exec(
    read("frontend/tests/style-node-kind-colors.spec.ts"),
  );
  assert.ok(colors, "style-node-kind-colors.spec.ts lists the kinds");
  assert.deepEqual(quotedWords(colors[1]), nodeKinds);
});

test("the ARC Script keywords the editor colors are the parser's", () => {
  const node = withoutComments(
    read("backend/src/main/java/dev/arc/engine/script/ArcScriptNodeParser.java"),
  );
  const script = withoutComments(
    read("backend/src/main/java/dev/arc/engine/script/ArcScriptParser.java"),
  );
  const words = new Set();
  // Declaration statements: the keyword table.
  const table = /declarationKeywords\(NodeKind kind\) \{([\s\S]*?)\n  \}/.exec(node);
  assert.ok(table, "ArcScriptNodeParser declares the keyword table");
  for (const [, word] of table[1].matchAll(/"([a-z]+)"/g)) words.add(word);
  // Headers, connections and input declarations: the words of the grammar's
  // patterns, which are the literals that spell whitespace.
  for (const source of [node, script])
    for (const [, literal] of source.matchAll(
      /"((?:[^"\\]|\\.)*\\\\s(?:[^"\\]|\\.)*)"/g,
    ))
      for (const [word] of literal
        .replace(/\\\\./g, " ")
        .replace(/\[[^\]]*\]/g, " ")
        .matchAll(/\b[a-z]{2,}\b/g))
        words.add(word);
  // Document headers are compared whole.
  for (const [, literal] of script.matchAll(/equalsIgnoreCase\("([a-z 0-9]+)"\)/g))
    for (const [word] of literal.matchAll(/[a-z]+/g)) words.add(word);
  // Connections name the fixed handles.
  const handles = withoutComments(
    read("backend/src/main/java/dev/arc/model/Handles.java"),
  );
  for (const [, word] of handles.matchAll(
    /public static final String [A-Z]+ = "([a-z]+)";/g,
  ))
    words.add(word);
  assert.ok(words.size >= 20, "the parser's grammar words were found");
  // arcLanguage.ts: the keyword list, plus true and false, which the script
  // reads as handles and an expression as literals; null is a literal only.
  const language = read("frontend/src/features/language/arcLanguage.ts");
  const list = (name) => {
    const match = new RegExp(`${name}: \\[([^\\]]*)\\]`).exec(language);
    assert.ok(match, `arcLanguage.ts lists ${name}`);
    return [...match[1].matchAll(/"([a-z]+)"/g)].map(([, word]) => word);
  };
  const colored = [
    ...list("keywords"),
    ...list("constants").filter((word) => word !== "null"),
  ];
  assert.deepEqual([...colored].sort(), [...words].sort());
  // expressionSymbols.ts classifies statements by these words too.
  const symbols = read("frontend/src/domain/expressionSymbols.ts");
  const classified = new Set();
  for (const [, items] of symbols.matchAll(
    /\[("[a-z]+"(?:, "[a-z]+")*)\]\.includes\(/g,
  ))
    for (const [, word] of items.matchAll(/"([a-z]+)"/g)) classified.add(word);
  for (const [, word] of symbols.matchAll(
    /\.text(?:\.toLowerCase\(\))? === "([a-z]+)"/g,
  ))
    classified.add(word);
  assert.ok(classified.size >= 8, "expressionSymbols.ts names the statement keywords");
  for (const word of classified)
    assert.ok(words.has(word), `${word} is a keyword of the parser`);
});

test("every path the frontend API clients request is in docs/openapi.yaml", () => {
  const operations = specOperations();
  const normalize = (path) =>
    path
      .replace(/\$\{pathId\([^)]*\)\}/g, "{id}")
      .replace(/\$\{version\}/g, "{version}")
      .replace(/\?.*$/, "");
  for (const module of ["rules", "sources", "studio"]) {
    const source = read(`frontend/src/api/${module}.ts`);
    const helpers = new Map(
      [...source.matchAll(/const (\w+) = \([^)]*\) => `([^`]*)`;/g)].map(
        ([, name, path]) => [name, path],
      ),
    );
    const calls = [
      ...source.matchAll(
        /http\.(get|post|put|delete)(?:<[^(]*>)?\(\s*(?:`([^`]*)`|"([^"]*)"|(\w+)\()/g,
      ),
    ];
    assert.ok(calls.length >= 5, `${module}.ts requests through the transport`);
    for (const [, method, template, literal, helper] of calls) {
      const path = template ?? literal ?? helpers.get(helper);
      assert.ok(path !== undefined, `${module}.ts: ${helper} builds a path`);
      const operation = `${method.toUpperCase()} ${normalize(path)}`;
      assert.ok(
        operations.has(operation),
        `${operation} (${module}.ts) is in docs/openapi.yaml`,
      );
    }
  }
});
