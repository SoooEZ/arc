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
| `OUTPUT` | `expression` returning a value | None |

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

## Canvas layout

**Arrange graph** uses ELK's layered layout with fixed port positions matching the rendered handles: True at 27% of node width, False at 73%, incoming connections at the top center. This lets crossing minimization reorder branch nodes and their downstream nodes with the exit order in view. Measured node dimensions prevent overlaps. Stable input ordering and a fixed seed make repeated arrangements reproducible.

The layout module loads on demand. Layout updates only node positions, preserving IDs, edges, handles, expressions, references, and inputs. Saving persists these positions in the shared graph/ARC Script definition. Incomplete drafts with disconnected nodes can still be arranged; invalid handles fail without dropping connections. Historical versions remain read-only. Crossing minimization is a heuristic; shared descendants or other graph constraints can prevent a completely crossing-free layout.

## Validation and execution

Draft saves enforce document shape, identifiers, declared input types, and size limits, but allow an unfinished graph. Publishing, validation, and preview require a complete executable graph:

1. Exactly one Input node, with no incoming edges.
2. Correct outgoing branches for each node; unique node/edge IDs and no dangling edges.
3. Every node reachable from Input, no graph cycles, and all terminating paths returning through Output.
4. Parseable expressions and existing referenced versions with required parameter mappings.
5. Variables guaranteed to be available whenever the node runs. Branch-sensitive analysis combines variables from simultaneous upstream computations and checks all alternatives at conditional merges. It uses bounded Boolean decision diagrams rather than enumerating every branch combination.
6. Result variable names are valid and cannot overwrite an input. Mutually exclusive branches can assign the same result variable. Simultaneous independent writes to the same variable fail at the merge instead of silently overwriting one another; use distinct names. Sequential updates keep the later value.

Input values are not coerced: a numeric string is not a number. Unknown input names are rejected to catch integration typos. An omitted parameter uses its default; an explicitly supplied `null` does not. Required null values fail validation; optional nulls can be tested with `== null`.

Every outgoing handle supports multiple target nodes. The evaluator processes the DAG in topological order with node IDs as a stable tie-breaker. Each activated node runs once; skipped condition branches are resolved without evaluation. A join waits until every incoming predecessor has either executed or been skipped, then merges only the active upstream scopes. Sibling results are not visible until a connecting path brings them into scope. Execution is deterministic and sequential, not concurrent HTTP dispatch. Conditions require booleans at runtime. Result types and arithmetic operand types are also checked at runtime; graph validation does not prove all possible input values are safe (for example, a denominator may still be zero). Errors include structured `locations` with node ID, label, rule ID and version. Nested failures retain both the child location and the calling reference. The test panel can focus the current graph or open a pinned child node in the reference modal. Nested references replace the current modal view; Back restores the previous rule and selected node, and Close all returns to the unchanged parent draft.

If exactly one Output is reached, its value is returned unchanged. When multiple Outputs are reached, `result` is an object keyed by their node IDs (including null values); Output labels can change without changing these keys. Existing decision trees that select one of several Outputs keep their original result shape. Reused rules follow the same convention.

An execution has isolated per-node variable scopes, a depth guard, and a shared trace across nested calls. Each trace step includes rule ID, version, node ID, node label, value, chosen branch, and nesting depth. Child steps appear before the reference node's returned result. `durationMicros` measures engine execution and dependency resolution, excluding HTTP and the initial root-version lookup.

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

Identifiers use letters, digits, and underscores, start with a letter or underscore, and are at most 64 characters. `true`, `false`, and `null` are reserved. Values include numbers, strings, booleans, nulls, arrays and objects. Supported collection operations and object access are described in [the studio guide](studio.md). Reflection, arbitrary host code, and IO inside expressions are unavailable; external values enter through configured data sources.

## Bounds and deployment

- At most 50 inputs, 100 nodes, and 200 edges per graph.
- Expressions at most 2,000 characters, 256 tokens, and 48 nested parse levels.
- Strings at most 2,000 characters; numbers have bounded precision and scale.
- At most 16 nested rule calls and 1,000 total execution steps.
- Rule metadata and parameter bindings have explicit size limits.
- Nginx caps request bodies at 1 MiB; Java also caps API request bodies independently.

The service has no JWT requirement yet. Both reads and writes are intentionally open, and CORS allows any origin. Versioning and a restricted expression language are foundations for predictable execution; they do not substitute for the future production authentication, authorization, quota, and operational work.

## Code and graph share a definition

ARC Script is a declarative text representation of the existing JSON graph, not JavaScript, Ruby, or host code. `/api/studio/build` parses it into `Definition`; `/api/studio/render` converts a definition back into canonical text. Stable node IDs, edge IDs, positions, input schemas, source bindings, pinned references, and comment text are retained. Comments are normalized to a header. A syntax error returns line/column diagnostics and no partial graph. Build accepts structurally sound work in progress; full path/scope/reference validation runs before publishing and execution.

The standalone Code studio uses a locally bundled Monaco editor, completion and hover providers generated from `/api/functions`, module snippets, rule insertion, and a node outline. Both views operate on the same in-memory draft and use the existing optimistic revision lock. Code is compiled before saving, publishing, testing, or switching to the canvas; canvas edits regenerate code. Publication still creates immutable graph snapshots.

## Connected inputs

`data_sources` identifies a provider. `data_source_versions` stores immutable JSON configurations. Every sourced input pins a source ID and version. Providers currently support local lookup tables and HTTP GET endpoints returning JSON. Source arguments are expressions over declared rule inputs, with dependency-cycle validation and recursive resolution independent of declaration order. Caller-supplied values always win, including an explicit null (which then obeys the input's required/type contract). Omitted inputs invoke their source; defaults are used on failure only with an explicit `DEFAULT` policy. JSON Pointer selects the response field before strict type validation. Execution reports source reads and fallback status without secrets.

HTTP requests use encoded query parameters, a per-request deadline, 1 MiB response limit, and no redirect/retry/proxy behavior. DNS is checked when the socket resolves, preventing a validate-then-resolve gap. Private/reserved addresses are blocked unless the exact hostname is configured in `ARC_HTTP_PRIVATE_HOSTS`. `ARC_HTTP_ALLOWED_HOSTS` optionally restricts all destinations. Secret headers contain aliases only; the server reads `ARC_SECRET_<ALIAS>`. Secrets require an explicitly allowlisted destination. Operator environment changes are outside source versioning. External values are live and can change even when configuration is pinned.

## Extended expressions

The expression engine keeps decimal arithmetic for core math. Apache POI supplies context-free Excel calculations; these use Excel floating-point semantics. A shared capability registry exposes callable functions and reference-only functions separately. This is an Excel/Dentaku-inspired calculation dialect, not a workbook engine or a drop-in Dentaku implementation. No cell references, workbook formulas, macros, arbitrary Ruby, or host-language calls are evaluated. Functions requiring workbook context or a missing adapter are shown as reference-only.

Arrays and objects are input types. Arrays can be used as Excel ranges. `MAP`, `FILTER`, `ALL`, `ANY`, and `REDUCE` use explicitly scoped local identifiers. `PLUCK` and `GET` accept quoted dot paths. Object property access is available inside ordinary expressions (`customer.country`, `item.price`). Expressions remain bounded by source length, token/depth limits, numeric/string limits, collection size/depth limits, and an iteration budget.

## Typed parameter mapping

The inspector requests `/api/variables` for the current definition and offers inputs and guaranteed connected upstream results. A mapping can select a variable, enter a typed constant, write an ARC expression, or omit the binding to use the callee’s default/source. Plain string constants are escaped into ARC literals automatically, including empty strings, quotes and backslashes. The simple condition builder and data-source mappings use the same controls. Output nodes also offer variable, constant and expression modes. Output variables are not restricted by value type, so arrays and objects can be returned directly. Output constants have an explicit number/string/boolean/array/null selector. These controls continue to store an ordinary ARC expression, preserving code/graph round trips and published version behavior. Expression mode and ARC Script retain explicit string literal syntax. Rule metadata lives in the gear dialog; applying it updates the draft and Save draft persists it.


## Node code and graph diagnostics

`POST /api/studio/node/render` accepts `{definition, nodeId}` and returns the selected node’s ARC Script. Input nodes also include the input schema and source mappings. `POST /api/studio/node/build` accepts `{definition, nodeId, source}`, parses exactly one node with the same ID/type, merges its outgoing connections and (for Input) parameters into the supplied definition, and returns the ordinary build response. Other nodes, incoming edges and existing notes are preserved. Invalid syntax or missing edge targets return diagnostics without applying a partial edit. Changes update only the local draft until saved. Published versions remain read-only.

`POST /api/diagnostics` accepts a definition and returns `{message, locations}[]`. It reuses validation and branch-sensitive variable analysis, collecting errors across nodes and checking source-mapping expressions. It never evaluates formulas or fetches external HTTP data. The graph debounces checks, discards stale responses, and marks affected nodes and the minimap red. Nested runtime failures mark the calling reference and retain the child location for the modal. Runtime-only failures still require testing with inputs; static diagnostics do not guarantee success for all possible values.

Function categories describe their purpose independently of their Excel/ARC origin. The studio and node editor show collapsed category groups with counts, search across groups, hover documentation and insertion. Unsupported functions remain under Reference only.

## Java and Rails deployments

`backend/` provides the Spring Boot API and Java engine. `backend-rails/` provides an independent Rails 8.1 API, Active Record persistence and Ruby engine. It needs no Java executable, JVM, JAR, build tool or auxiliary calculation service. The frontend uses relative `/api` URLs; the Compose Rails overlay replaces only the `api` service.

Ruby's `ArcRuntime` dispatches to `Arc::Expressions`, `GraphPlan`, `Validator`, `Engine`, `Script`, `Parameters` and `Sources`. Expressions are tokenized into a bounded syntax tree and interpreted without host-language eval. Decimal operators use BigDecimal with DECIMAL128 precision. The Excel adapter implements the enabled catalog in Ruby; statistical, matrix and financial operations use floating-point arithmetic as on Java. The engine uses branch-sensitive availability analysis and tracks each upstream value's origin when executing fan-out and joins. Nested references retain trace/error locations. Active Record stores JSONB through a decimal-preserving codec, so numeric data stays numeric through HTTP, database storage and evaluation.

HTTP sources use Net::HTTP with explicit timeouts, response-size limits, no redirects or automatic retries, and per-execution read limits. DNS answers are checked against the allowlist/private-address policy, and the approved address is pinned to the connection while retaining the original hostname for TLS. Secret aliases resolve from the Rails process environment. Lookup sources and rule references resolve immutable versions through Active Record.

`database/migrations` is the single SQL authority. Java packages those files into its classpath and runs Flyway. Rails `arc:prepare` executes them directly with a Ruby runner and maintains the same `flyway_schema_history` versions and checksums. It locks migration history, verifies previously applied checksums, and commits new SQL and history atomically. Empty workspaces are seeded from `contracts/samples.json`; initialized workspaces retain their rules. Add schema changes to this one migration chain, never a competing Rails migration directory. Use one selected backend per workspace and stop/switch it before starting the other.

Shared fixtures in `contracts/` and `scripts/contract.py` / `function_contract.py` verify API and calculation compatibility. CI also runs both API/browser suites, Ruby-only calculation and HTTP-source tests, a fresh Rails → Java → Rails → Java database switch, and a check that the Rails image contains no Java artifacts. Both implementations must be updated for behavior changes; the tests detect regressions, but do not translate code or prove every numerical corner case equivalent. See the contract guide for floating-point tolerances and Excel scope.
