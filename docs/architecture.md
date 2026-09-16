# Architecture and graph contract

## Storage and versioning

`rules` stores identity, metadata, a mutable draft graph, edit revision, and latest published version. `rule_versions` stores immutable snapshots, keyed by `(rule_id, version)`. Flyway owns relational schema migrations; JSON graph documents carry `schemaVersion` for future graph migrations.

PostgreSQL JSONB fits this graph because node shapes vary, graph structure is bounded, and a complete version is loaded for execution. Relational keys provide stable identities and atomic release creation. Graph coordinates and labels live in the document, allowing exact editor reconstruction, but do not affect execution semantics.

Publishing acquires a row lock, checks the submitted edit revision, validates the graph, inserts a new version, and advances the latest-version pointer in one transaction. Save also locks and checks revisions. Competing edits return `409` rather than silently overwriting one another.

References always contain a rule ID and positive integer version. Publishing never resolves a floating “latest” dependency. Updating or republishing a child cannot alter an already published parent. A parent must explicitly change its pinned reference and publish a new version to adopt the change.

## Graph document

```json
{
  "schemaVersion": 1,
  "inputs": [
    {"name": "amount", "type": "NUMBER", "required": true, "defaultValue": null}
  ],
  "nodes": [
    {"id": "input", "type": "INPUT", "label": "Inputs", "position": {"x": 280, "y": 0}},
    {"id": "calculate", "type": "FORMULA", "label": "Apply tax", "position": {"x": 280, "y": 160}, "expression": "round(amount * 1.08, 2)", "output": "total"},
    {"id": "result", "type": "OUTPUT", "label": "Return total", "position": {"x": 280, "y": 320}, "expression": "total"}
  ],
  "edges": [
    {"id": "input-calculate", "source": "input", "target": "calculate", "sourceHandle": "next"},
    {"id": "calculate-result", "source": "calculate", "target": "result", "sourceHandle": "next"}
  ]
}
```

| Node type | Configuration | Outgoing handles |
| --- | --- | --- |
| `INPUT` | Uses graph-level `inputs`. Exactly one per graph. | `next` |
| `FORMULA` | `expression`, `output` variable | `next` |
| `CONDITION` | Boolean `expression` | `true` and `false` |
| `REFERENCE` | `ruleId`, `version`, `bindings`, `output` variable | `next` |
| `OUTPUT` | `expression` returning a scalar result | None |

Example reference:

```json
{
  "id": "discount",
  "type": "REFERENCE",
  "label": "Premium discount",
  "position": {"x": 100, "y": 320},
  "ruleId": "apply-discount",
  "version": 1,
  "bindings": {"amount": "orderTotal", "rate": "0.2"},
  "output": "price"
}
```

Bindings are expressions evaluated in the caller's scope. The callee receives only mapped inputs and its own defaults; it does not see the caller's other variables. Its result becomes the caller's `output` variable. References can be nested inside every artifact kind, including formulas.

## Validation and execution

Draft saves enforce document shape, identifiers, declared input types, and size limits, but allow an unfinished graph. Publishing, validation, and preview require a complete executable graph:

1. Exactly one Input node, with no incoming edges.
2. Correct outgoing branches for each node; unique node/edge IDs and no dangling edges.
3. Every node reachable from Input, no graph cycles, and all terminating paths returning through Output.
4. Parseable expressions and existing referenced versions with required parameter mappings.
5. Variables available on every incoming path. A topological data-flow analysis intersects the scopes of merged branches.
6. Result variable names are valid and cannot overwrite an input. Different branches can assign the same result variable before merging.

Input values are not coerced: a numeric string is not a number. Unknown input names are rejected to catch integration typos. An omitted parameter uses its default; an explicitly supplied `null` does not. Required null values fail validation; optional nulls can be tested with `== null`.

The evaluator walks only the selected branch. Conditions require booleans at runtime. Result types and arithmetic operand types are also checked at runtime; graph validation does not prove all possible input values are safe (for example, a denominator may still be zero). Errors identify the failing node.

An execution has a local variable scope, depth guard, and shared trace across nested calls. Each trace step includes rule ID, version, node ID, node label, value, chosen branch, and nesting depth. Child steps appear before the reference node's returned result. `durationMicros` measures engine execution and dependency resolution, excluding HTTP and the initial root-version lookup.

## Expression language

Expressions are parsed into a small syntax tree, never delegated to a general-purpose scripting engine.

| Feature | Examples |
| --- | --- |
| Decimal arithmetic | `amount * (1 - rate)`, `a + b`, `a / b`, `a % b` |
| Numeric literals | `100`, `0.25`, `.5`, `1e3` |
| String literals | `"premium"`, `'premium'` |
| Comparisons | `==`, `!=`, `<`, `<=`, `>`, `>=` |
| Boolean logic | `&&`, `\|\|`, `!`, `true`, `false` |
| Null checks | `optionalValue == null` |
| Math functions | `min(a, b, ...)`, `max(a, b, ...)`, `abs(x)`, `floor(x)`, `ceil(x)` |
| Rounding | `round(value, 2)` (HALF_UP; precision 0–12) |
| Conditional value | `if(condition, valueWhenTrue, valueWhenFalse)` |

Numeric operations use Java `BigDecimal` with DECIMAL128 (34 significant digits). Decimal addition avoids binary floating-point drift. Nonterminating division is rounded with DECIMAL128; use explicit `round` for business-specific decimal places. Equality treats `1` and `1.0` as equal. Strings support equality and lexicographic ordering; `+` is numeric only. Boolean operators and `if` short-circuit.

Identifiers use letters, digits, and underscores, start with a letter or underscore, and are at most 64 characters. `true`, `false`, and `null` are reserved. Values are scalar: number, string, boolean, or optional null. Arrays, object navigation, dates, loops, regex, arbitrary function calls, reflection, IO, and network access are outside this release.

## Bounds and deployment

- At most 50 inputs, 100 nodes, and 200 edges per graph.
- Expressions at most 2,000 characters, 256 tokens, and 48 nested parse levels.
- Strings at most 2,000 characters; numbers have bounded precision and scale.
- At most 16 nested rule calls and 1,000 total execution steps.
- Rule metadata and parameter bindings have explicit size limits.
- Nginx caps request bodies at 1 MiB; Java also caps API request bodies independently.

The service has no JWT requirement yet. Both reads and writes are intentionally open, and CORS allows any origin. Versioning and a restricted expression language are foundations for predictable execution; they do not substitute for the future production authentication, authorization, quota, and operational work.
