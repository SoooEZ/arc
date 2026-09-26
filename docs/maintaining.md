# Maintaining and extending ARC

ARC remains one React application and one Java application. The HTTP paths, graph JSON, ARC Script, published versions, database migrations, and execution semantics remain the public contracts. Start with [the graph contract](architecture.md) and [API reference](api.md) before changing them.

For AI-assisted changes, [the project guidance and Skills](ai-quality.md) turn these boundaries into implementation, refactoring and review workflows. Their [pinned upstream references](ai-sources.md) document the ideas selected and adapted to ARC.

Read the applicable [review lessons](review-lessons.md) before changing a boundary. They connect failures found in earlier reviews to preventive rules and existing behavior tests; dated reports retain the original evidence.

## Backend boundaries

| Package | Responsibility | Extension point |
| --- | --- | --- |
| `api` | HTTP binding, response status, error translation, request limits | Controllers call application services; no SQL |
| `rule` | Draft commands, publication transactions, definition checks, execution orchestration | `RuleRepository` separates storage; definition and execution services are separate |
| `engine` | Narrow dependency ports and shared identifier/value policies | `RuleResolver`, `SourceReader`, `MemoizingRuleResolver`, `Identifiers`, `InputTypes` |
| `engine.expression` | Expression parsing, evaluation, bounded values and function capabilities | `Expressions` and `Functions`; POI stays behind `ExcelFunctionAdapter` |
| `engine.script` | ARC Script scanning, document/node grammar and canonical rendering | `ArcScript` owns whole-graph and single-node build/render operations |
| `engine.graph` | Topological order, ancestry and branch-sensitive available variables | Read-only `GraphPlan`; topology, scopes and Boolean conditions remain internal |
| `engine.validation` | Draft shape, executable graph checks and editor diagnostics | `Validator` coordinates shared shape and node checks |
| `engine.execution` | Graph execution sessions, joins, traces and parameter resolution | `Engine` creates a `GraphExecution`; nested calls share execution limits |
| `source` | Version commands, static binding checks, typed reads and provider registry | `SourceService` owns writes; `SourceExecutionService` implements `SourceReader` |
| `source.http`, `source.lookup` | Provider-specific validation and fetching | `SourceAdapter` implementations registered by `SourceAdapters` |
| `persistence` | JDBC, row locks, JSONB serialization, repository implementations | `JdbcRuleRepository`, `JdbcSourceRepository`, `JsonCodec` |
| `model`, `error` | Portable records and structured application errors | No Spring, JDBC, or HTTP imports |

Dependencies point from HTTP into application services, and from application services into the engine and repository interfaces. JDBC implementations depend on those interfaces. The engine does not depend on controllers, JDBC, or source application services. Spring constructor injection assembles the implementations; its component annotations in the engine are intentional, so this is not a framework-free core.

Catalog/history consumers use bounded summary pages; one selected rule/version/source is fetched on demand. Full-list repository/API methods remain only for compatibility. Keep summary and detail types distinct; a summary cannot stand in for an editable definition. Searches belong on the server, and async detail responses retain selection identity.

Execution trace collection is optional and retains complete prefix steps within 256 KiB of UTF-8 JSON. Execution step accounting is independent of retained trace length. Runtime deadline exhaustion is `504`, bypasses source/expression fallbacks and remains attached to node locations. `timing` measures server preparation/execution; the UI separately measures request round-trip latency including JSON parsing.

The root `engine` package contains shared contracts, not feature orchestration. `Identifiers.isValid` owns identifier syntax and reserved words; `InputTypes.check` owns strict declared value types. Expressions and source providers can use these policies without depending on graph validation. Required, missing, explicit-null and default handling remain with the caller. Keep implementation helpers package-private within their feature; moving files should not turn every helper into a public API.

`RuleService` owns create/save/publish transaction boundaries. A publish must lock the draft, check its revision, validate pinned dependencies, and insert the version in one transaction. Repository replacements must preserve these guarantees, including `409` conflicts. Source revisions use the same application transaction boundary. Never move a write outside that boundary just to shorten a service method.

`RuleExecutionService` creates one `MemoizingRuleResolver`, one source configuration session, one execution-plan session and one `Parameters` instance per execution. The resolver is keyed by rule ID and version; the source session shares pinned configuration between static validation and live provider reads. These request caches, input scopes and read budgets never become singleton state. The engine separately owns a bounded cache of immutable compiled published plans (128 entries, 8 MiB estimated weight units, not measured heap bytes). Preview roots are request-local. Static diagnostics inspect source definitions but never fetch external values.

Within `engine.execution`, the stateless `Engine` facade creates a `GraphExecution` for each call. That session owns nested rule dispatch, active-rule guards and the shared trace. `ExecutionScope` owns values and their producing nodes, so joins distinguish sequential updates from conflicting sibling writes. `Parameters` owns recursive source argument resolution, overrides, fallbacks and the shared read budget. Keep these policies together when extending execution; a node-kind hierarchy would obscure the related branch and join invariants.

`engine.expression.Expressions.compile/evaluate` and `Compiled.variables/evaluate` are the expression entry points. `ExpressionParser` owns tokenization, precedence and lexical dependency analysis; it compiles without evaluating data. `ExpressionRuntime` owns operators, lazy functions and scoped collection execution. Each evaluation gets an explicit context and operation budget; child collection scopes share that budget, while separate or reentrant evaluations do not. Compiled code is immutable and hides its raw evaluation nodes, so callers cannot bypass the evaluation boundary. No thread-local execution state or independent global expression cache is used. A compiled graph retains its validated expressions for reuse; each evaluation still creates its own scope and operation budget, while sharing the request deadline.

String literal decoding uses a private Jackson `JsonFactory` configured for ARC's existing single quotes, unknown escapes and raw control characters. It does not change the application's HTTP, source or stored-JSON parser settings. `ExpressionCompatibilityTest` covers the language contracts needed by any future parser/library replacement, including decimal literals, strict types, case-sensitive names, lazy failures, missing/null values and repeated/concurrent execution. See [the library assessment](reviews/2026-09-22-library-options.md) before substituting another engine.

`Functions` is the evaluator-facing facade. `FunctionCatalog` assembles immutable capabilities and checks arity. `BuiltinFunctionCatalog` pairs ARC-owned help with argument bounds; `ExcelFunctionHelp` supplies typed documentation overrides, and `ExcelFunctionCategories` groups the remaining POI entries. `ExcelFunctionAdapter` owns POI value conversion and invocation. ARC decimal operations retain their existing semantics; POI calculations retain Excel floating-point semantics. Ordinary functions belong in `Functions`, lazy/collection evaluation in `ExpressionRuntime`; change the parser only when a function introduces binding syntax, such as the item/accumulator identifiers in `REDUCE`. The catalog fixtures preserve API order, help, snippets and arity; update them explicitly for intentional capability changes rather than regenerating them to accept a refactor.

`engine.validation.Validator` coordinates `GraphValidation` for executable checks and `GraphDiagnostics` for ordered diagnostic collection. Both reuse `DefinitionShape` for draft structure/limits and `NodeValidation` for node semantics and expression enumeration. `InputValidation` owns input declarations and source-binding shape, using the shared identifier/type policies. Add a node's expression fields to `NodeValidation` so incomplete or cyclic graphs receive the same syntax coverage as executable graphs. Diagnostic collection must retain partial graph locations and must not fetch source values.

`engine.graph.GraphPlan` exposes order, incoming/outgoing edges, ancestry and guaranteed variables through read-only accessors. `GraphTopology` owns graph indexing and stable topological order; `BranchScopes` owns conditional variable availability; `BooleanConditions` owns the bounded Boolean decision diagram operations. Keep the scope algorithm cohesive: it reasons about mutually exclusive branches and simultaneous writes, rather than enumerating every execution path.

`Validator.compile` produces a `CompiledGraph` containing the checked topology and parsed expressions. `ExecutionPlans` reuses that object between application preparation and graph execution, within repeated reference calls and across immutable published pins. The cache stores detached definitions, uses entry/weight bounds and is discarded on process restart; it never stores inputs, results, source values or mutable drafts. Embedded `Engine.execute` callers retain request-only behavior because their supplied definitions need not represent immutable database versions. Application-level source-contract validation remains request-local and shares the source session with runtime reads. Referenced graph plans are prepared when reached, preserving branch/error behavior.

`engine.script.ArcScript` is the studio facade. `ArcScriptScanner` tracks statement boundaries, quoting, comments and source locations; `ArcScriptParser` owns document declarations and input schemas; each `ArcScriptNodeParser` owns one node's declarations, expressions, pins and outgoing edges. `ArcScriptSyntax` shares lexical forms and strict JSON literal decoding, and `ArcScriptRenderer` produces canonical text. Single-node replacement belongs to the facade because it combines a parsed fragment with its containing graph. A fragment may replace only its node and outgoing edges (plus parameters for Input); incoming edges, unrelated nodes and graph notes remain owned by the containing graph. Grammar changes need both parser and renderer changes, with canonical-text and round-trip tests. The embedded parser bounds source at 1,048,576 characters; HTTP independently limits the encoded JSON request to 1 MiB bytes.

### Adding a data source

1. Implement `SourceAdapter` in a provider package as a Spring component with a unique `kind()`, configuration validation, and `fetch(...)`. `SourceAdapters` discovers it through constructor injection and rejects duplicate kinds on startup. No dispatch branch is needed in either source service.
2. Preserve strict typed input/default handling in `SourceExecutionService`; return the provider's JSON-compatible value. Field extraction stays in `JsonPointerExtractor`, and missing/fallback policy stays in `engine.execution.Parameters`.
3. If the provider needs new configuration, extend the portable `SourceDefinition`, frontend `SourceConfig`, source form, API specification, and ARC Script round-trip handling where applicable. Registering a strategy alone does not create its UI or storage contract. Unsupported-kind errors are generated from the registered kinds.
4. Test the adapter independently and add an API workflow for source creation, pinned versions, missing values and failures. For HTTP-based implementations, reuse the bounded transport and host/secret policy rather than creating an unrestricted HTTP client.

`SourceService` owns versioned configuration commands and their transactions. `SourceExecutionService` owns test/read dispatch and implements the engine's narrow `SourceReader` port. An omitted test version uses `SourceRepository.latest` to read the persisted current pointer and definition once; an explicit version or rule binding remains pinned. Neither path loads the full version history. `JdbcSourceRepository` shares one typed row mapper across those reads.

`SourceServiceTest` and `SourceExecutionServiceTest` demonstrate an additional provider through configuration validation and typed reads. Use that pattern for new providers. Use repository mocks for command ordering and rejected writes; real PostgreSQL smoke tests cover actual revision locks, transactions, and latest/pinned selection.

Within `source.http`, `HttpDestinationPolicy` owns configured URL/host/secret-header policy and implements HttpClient5's `DnsResolver`, checking IP addresses when the connection resolves. Configuration validation itself does not perform DNS or HTTP requests. Keep reserved prefixes explicit and test both sides of their boundaries. An allowed hostname does not grant a private-address exception. `HttpSource` owns request construction, a lifecycle-managed connection pool (100 total/20 per route), per-call cancellation bounded by the shared execution deadline, bounded response parsing and transport error translation; changing destination policy should not require rewriting that transport. `HttpSourceAdapter` connects those responsibilities to the registry. The local table provider remains in `source.lookup`.

### Adding a function or node kind

For a function, update catalog metadata and its execution implementation, then test arity, types, edge cases, and a studio build/execution round trip. A reference-only entry must never advertise itself as executable. Monaco help and function chips use `/api/functions`, so they should not duplicate a handwritten function catalog.

A node kind changes the graph contract, not just a switch statement: review `Definition`, `Validator`, `GraphPlan`, `Engine`, `ArcScript`, frontend types, node defaults, the inspector registry, graph presentation, and documentation together. Add path/scope tests and a code/graph round trip. Node kinds deliberately remain explicit in the engine; a plugin hierarchy would hide the graph invariants without helping these related execution behaviors.

`Node.storesResult()` identifies result-producing backend nodes. Frontend `domain/nodePorts.ts` supplies stable handles and positions to graph mutations, canvas rendering, and layout. Switch case order controls first-match priority; its case IDs own the connections. `DataFunctions` owns object construction and explicit scalar conversion, while lazy `COALESCE` stays with the expression evaluator.

## Frontend boundaries

| Location | Responsibility |
| --- | --- |
| `api/` | Typed resource clients and injectable HTTP transport; status and graph error locations |
| `domain/` | Pure graph mutations, semantic identity, upstream variable choices, expression literals |
| `app/` | Hash navigation, dirty-document guards, library loading, workspace header/sidebar, theme and create dialog |
| `features/library/` | Library page, filtering, rule cards and rule previews |
| `features/editor/Editor.tsx` | Compose the document, graph/code view, inspector, execution panel and dialogs |
| `features/editor/documentState.ts` | Pure, atomic draft/code/trace state transitions |
| `features/editor/useRuleDocument.ts` | Save/build/publish commands, versions, dirty state and code synchronization |
| `features/editor/useNodeExpressionDraft.ts` | One node-code editing session: loading, diagnostics and applying a fragment |
| `features/editor/useGraphProblems.ts` | Static diagnostics, runtime errors and referenced-node error projection |
| `features/editor/canvas/` | Graph rendering, toolbar/outline, transient measurements, routing, layout, graph commands and focus |
| `features/editor/inspector/` | Exhaustive node-form registry, input cards/default controls and stable input-row editing identity |
| `features/expressions/` | Shared variable/constant/expression selection and the expression dialog |
| `features/studio/` | Code studio, insertion library, outline/problems, pure snippets and Monaco initialization/lifecycle |
| `features/execution/` | Preview panel, published API playground/reference, result/error views and cancellable execution requests |
| `features/sources/sourceDocument.ts` | Pure source selection, JSON buffers, saved baseline, version and request transitions |
| `features/sources/useSourceEditor.ts` | Source commands and resource loading around the source document |
| `features/sources/SourceConfigurationFields.tsx` | Provider-specific source configuration forms |
| `hooks/useAsyncResource.ts` | Debounced reads, abort/cleanup, stale-response suppression |
| `components/` | Feature-independent controls and icons; no imports from feature controllers or APIs |
| `styles/` | Named view/shared styles and responsive rules; `index.css` explicitly owns cascade order |

Import the relevant resource client from `api/rules`, `api/sources` or `api/studio`, and transport errors from `api/errors`. The unused aggregate facade has been removed. Pure domain functions and the document reducer must not import React, MUI, React Flow or network clients. They can be tested without mounting the editor or starting a server. The architecture check also guards shared controls from importing application/feature orchestration, and keeps routing geometry and source-binding reconciliation pure.

Place a component beside the feature that owns its behavior. `components/` is for controls usable independently of a particular feature; multiple callers alone do not make a domain editor generic. Shared rule-reference types belong to `features/editor/types`, so execution/error views do not import a dialog for their contract. Monaco and ELK remain behind lazy feature boundaries.

Use file length as a review signal, not a quota. A component around 200–300 lines should prompt a check for mixed responsibilities; retain a longer cohesive coordinator or algorithm when splitting it would merely forward props or fragment an invariant. Extract independently changeable regions, name their inputs/actions, and remove migrated entry points. Avoid duplicating state to make individual files shorter.

Graph and code edits share one document reducer. Building code updates the graph atomically; failed code builds preserve the buffer and prior graph. Saving advances the saved baseline. Node measurements never enter the graph document. Arrange results carry the draft they started from, so a late layout cannot replace a newer edit.

Arrange finishes with an immediate viewport fit. Do not await a cancelable React Flow transition while holding the document's command lock: user input can interrupt its animation without settling the returned promise. Other optional viewport animations must not control whether draft commands become available again.

Save acknowledgements also carry the submitted rule. The reducer advances the server revision and saved baseline while preserving edits made after submission; a stale code build must not replace a newer buffer. Disabled controls communicate pending commands, but reducer checks enforce the draft contract independently of those controls.

Read-only guards belong at command entry points as well as UI controls: a hidden Save button does not disable a Monaco keyboard action. Published-version loading has explicit loading/ready/failed states. A failed version fetch must not reveal the initial current draft under a historical-version label or send its definition for diagnostics, testing or export. Callers mount the document controller with a key containing rule ID and requested version; retry stays within that version's session.

Preview and published execution share a narrow request hook. Its key includes the graph/version and input buffer; changing either, rerunning, or unmounting invalidates the previous request. Only a current result may update the graph's trace or error locations. Example inputs, JSON-object parsing and cURL formatting live in `domain/executionInputs.ts`, so the API page does not import a test-panel component for data helpers.

Each source selection receives a session identity. Save responses update the source list and carry their source, selection and request identities. They cannot select another source or replace newer edits. Reopening the same source during its save can adopt the completed server revision while preserving any subsequent changes. Test responses additionally belong to the selected version and input buffer. Source reducers and buffer helpers stay free of React and network calls, allowing these race conditions to be tested as state transitions.

Async reads use a key describing the requested resource, an `AbortSignal`, and cleanup on selection changes/unmount. `semanticGraphKey` excludes positions: dragging a card changes the draft but does not refetch variables or diagnostics. A different expression or connection does. If a new consumer adds a query parameter, include it in the key; changing a loader closure alone does not refetch. Mutation commands remain explicit and serialize through the document controller.

Monaco providers are disposed on cleanup and restricted to their own model, so nested editors do not contribute duplicate suggestions to each other. The inspector registry must cover every `NodeType`. Reuse the existing value-binding controls for variable/constant/expression selection and string escaping.

`useArcEditor` owns the mounted model and diagnostic markers, including diagnostics received before Monaco finishes loading. Catalog insertion, outline navigation and problem navigation are separate studio regions. Module snippets declare cursor/end placement independently of their display name. Dynamic ARC literals must be escaped for Monaco snippet syntax after ARC/JSON quoting; actual argument tab stops remain executable. Pending reference-insertion reads abort on unmount and consult the current draft/read-only state on completion.

`useInputParameterRows` owns UI-only row identity across immutable input edits; neither array index nor an editable parameter name is a stable component key. Removing an input must discard only its raw JSON buffer/validity and keep other rows' unfinished edits and focus. Changing an input's type explicitly resets its default editor. Value-provider typeahead loads bounded catalog pages only while its dropdown is open. Search and refresh identity invalidate old results; pinned source detail stays independent of catalog pages. The embedded source manager reuses the ordinary source editor, keeps its dirty state separate from the rule, and blocks closing while any source save is pending. Source-version selection retains only mappings accepted by the selected pinned contract through `bindSourceVersion`; hidden obsolete parameters must not remain in the submitted graph.

Styles remain global, but are separated into named files. Their entry-point import order preserves shared rules, responsive rules and later overrides; avoid sorting imports alphabetically or moving a shared override into a lazy component. A stylesheet relocation can be checked against the original parsed CSS for selector/declaration and order equivalence, followed by affected narrow-viewport workflows.

`ExpressionField` keeps ordinary graph text inputs lightweight and lazy-loads `ExpressionDialog` on demand. That dialog reuses Code studio's catalog, insertion and Monaco providers, offering only in-scope variable names and no graph-module snippets. `/studio/expression/check` parses syntax and reports dependencies without evaluating values; the dialog cancels obsolete checks and preserves its caller's draft until Apply. Runtime type checks still belong to preview/execution.

## Design choices

The concrete SOLID applications are single-purpose services and forms, source strategies open to registration, substitutable repository/source contracts, narrow engine ports, and constructor-injected dependencies. The patterns used here are Repository, Strategy with a registry, Adapter, a request-scoped Decorator, and a reducer for document transitions. They address actual change points; there is no generic repository framework, event bus, or class hierarchy for every node.

These boundaries are maintenance rules, not a claim that every class is permanently complete. Keep grammar, expression execution and graph planning cohesive within their owners; split further only when a new independent responsibility appears, not based on line count alone.

## Verification

From the repository root:

```sh
python3 scripts/check_architecture.py
mvn -f backend/pom.xml clean verify
cd frontend
npm ci
npm run format:check
npm run test:unit
npm run build
cd ..
```

Use Java 21 for Maven. To format intentional changes, run `mvn -f backend/pom.xml spotless:apply` and `npm --prefix frontend run format`. `verify` enforces Java formatting. The lightweight architecture script checks declared imports, not reflection or fully qualified calls; behavioral tests and code review remain necessary.

The frontend unit command runs pure tests with Playwright's test runner and does not need a browser or server. The full `test:e2e` command includes these tests and browser workflows. Follow the [README disposable Compose instructions](../README.md#development-and-verification) for real PostgreSQL/API/browser tests without adding fixtures to your working database. CI runs all of these gates.
