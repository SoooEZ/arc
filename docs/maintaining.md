# Maintaining and extending ARC

ARC remains one React application and one Java application. The HTTP paths, graph JSON, ARC Script, published versions, database migrations, and execution semantics remain the public contracts. Start with [the graph contract](architecture.md) and [API reference](api.md) before changing them.

For AI-assisted changes, [the project guidance and Skills](ai-quality.md) turn these boundaries into implementation, refactoring and review workflows. Their [pinned upstream references](ai-sources.md) document the ideas selected and adapted to ARC.

## Backend boundaries

| Package | Responsibility | Extension point |
| --- | --- | --- |
| `api` | HTTP binding, response status, error translation, request limits | Controllers call application services; no SQL |
| `rule` | Draft commands, publication transactions, definition checks, execution orchestration | `RuleRepository` separates storage; definition and execution services are separate |
| `engine` | Parsing, graph planning, scope analysis, expressions, parameter resolution | `RuleResolver` and `SourceReader` expose only the capabilities an execution needs |
| `source` | Versioned source commands, binding validation, typed inputs, provider dispatch | `SourceAdapter` implementations registered by `SourceAdapters` |
| `persistence` | JDBC, row locks, JSONB serialization, repository implementations | `JdbcRuleRepository`, `JdbcSourceRepository`, `JsonCodec` |
| `model`, `error` | Portable records and structured application errors | No Spring, JDBC, or HTTP imports |

Dependencies point from HTTP into application services, and from application services into the engine and repository interfaces. JDBC implementations depend on those interfaces. The engine does not depend on controllers, JDBC, or source application services. Spring constructor injection assembles the implementations; its component annotations in the engine are intentional, so this is not a framework-free core.

`RuleService` owns create/save/publish transaction boundaries. A publish must lock the draft, check its revision, validate pinned dependencies, and insert the version in one transaction. Repository replacements must preserve these guarantees, including `409` conflicts. Source revisions use the same application transaction boundary. Never move a write outside that boundary just to shorten a service method.

`RuleExecutionService` creates one `MemoizingRuleResolver` and one `Parameters` instance per execution. The resolver is a decorator keyed by rule ID and version, reused during validation and execution. The parameter read budget is shared across nested calls. Neither cache nor execution state belongs in a singleton bean. Static diagnostics use source definitions but never fetch external values.

`Functions` is the evaluator-facing facade. `FunctionCatalog` owns immutable function metadata, arity, help, and supported/reference-only entries. `ExcelFunctionAdapter` owns POI value conversion and invocation. ARC decimal operations retain their existing semantics; POI calculations retain Excel floating-point semantics.

`Validator` coordinates executable graph checks and diagnostic collection. `DefinitionShape` owns draft structure and limits, `InputValidation` owns declared parameter types and source-binding shape, and `NodeValidation` owns node semantics and the expressions a node contains. Full validation and syntax-only diagnostics use the same expression enumeration. Add a node's expression fields there so incomplete or cyclic graphs receive the same syntax coverage as executable graphs. The helpers are package-private concrete collaborators; callers retain the existing `Validator` API.

`ArcScript` is the studio facade. `ArcScriptScanner` tracks statement boundaries, quoting, comments and source locations; `ArcScriptParser` builds graph records; `ArcScriptRenderer` produces canonical text. Single-node replacement belongs to the facade because it combines a parsed fragment with its containing graph. A fragment may replace only its node and outgoing edges (plus parameters for Input); incoming edges, unrelated nodes and graph notes remain owned by the containing graph. Grammar changes need both parser and renderer changes, with canonical-text and round-trip tests.

### Adding a data source

1. Implement `SourceAdapter` as a Spring component with a unique `kind()`, configuration validation, and `fetch(...)`. `SourceAdapters` discovers it through constructor injection and rejects duplicate kinds on startup. No dispatch branch is needed in `SourceService`.
2. Preserve strict typed input/default handling in `SourceService`; return the provider's JSON-compatible value. Field extraction stays in `JsonPointerExtractor`, and missing/fallback policy stays in `Parameters`.
3. If the provider needs new configuration, extend the portable `SourceDefinition`, frontend `SourceConfig`, source form, API specification, and ARC Script round-trip handling where applicable. Registering a strategy alone does not create its UI or storage contract. Unsupported-kind errors are generated from the registered kinds.
4. Test the adapter independently and add an API workflow for source creation, pinned versions, missing values and failures. For HTTP-based implementations, reuse the bounded transport and host/secret policy rather than creating an unrestricted HTTP client.

`SourceServiceTest` demonstrates an additional in-memory adapter without changing the service. Use that pattern for new providers. Use repository mocks for command ordering and rejected writes; real PostgreSQL smoke tests cover actual revision locks and transactions.

### Adding a function or node kind

For a function, update catalog metadata and its execution implementation, then test arity, types, edge cases, and a studio build/execution round trip. A reference-only entry must never advertise itself as executable. Monaco help and function chips use `/api/functions`, so they should not duplicate a handwritten function catalog.

A node kind changes the graph contract, not just a switch statement: review `Definition`, `Validator`, `GraphPlan`, `Engine`, `ArcScript`, frontend types, node defaults, the inspector registry, graph presentation, and documentation together. Add path/scope tests and a code/graph round trip. Node kinds deliberately remain explicit in the engine; a plugin hierarchy would hide the graph invariants without helping these related execution behaviors.

`Node.storesResult()` identifies result-producing backend nodes. Frontend `domain/nodePorts.ts` supplies stable handles and positions to graph mutations, canvas rendering, and layout. Switch case order controls first-match priority; its case IDs own the connections. `DataFunctions` owns object construction and explicit scalar conversion, while lazy `COALESCE` stays with the expression evaluator.

## Frontend boundaries

| Location | Responsibility |
| --- | --- |
| `api/` | Typed resource clients and injectable HTTP transport; status and graph error locations |
| `domain/` | Pure graph mutations, semantic identity, upstream variable choices, expression literals |
| `app/` | Hash navigation, dirty-document guards, library loading, sidebar and create dialog |
| `features/editor/documentState.ts` | Pure, atomic draft/code/trace state transitions |
| `features/editor/useRuleDocument.ts` | Save/build/publish commands, versions, dirty state and code synchronization |
| `features/editor/useNodeExpressionDraft.ts` | One node-code editing session: loading, diagnostics and applying a fragment |
| `features/editor/useGraphProblems.ts` | Static diagnostics, runtime errors and referenced-node error projection |
| `features/editor/useGraphCanvas.ts` | React Flow nodes, edges and UI measurements |
| `features/editor/inspector/` | Node-specific forms selected by an exhaustive node-type registry |
| `features/studio/` | Pure module/reference snippets and shared Monaco insertion, completion and hover behavior |
| `features/execution/useExecutionRequest.ts` | Request ownership, cancellation, result and error state for preview and published execution |
| `features/sources/sourceDocument.ts` | Pure source selection, JSON buffers, saved baseline, version and request transitions |
| `features/sources/useSourceEditor.ts` | Source commands and resource loading around the source document |
| `features/sources/SourceConfigurationFields.tsx` | Provider-specific source configuration forms |
| `hooks/useAsyncResource.ts` | Debounced reads, abort/cleanup, stale-response suppression |
| `components/` | Reusable UI and page composition |

`api.ts` remains a compatibility facade over the resource clients. New controllers/hooks should import the relevant resource client. Pure domain functions and the document reducer must not import React, MUI, React Flow or network clients. They can be tested without mounting the editor or starting a server.

Graph and code edits share one document reducer. Building code updates the graph atomically; failed code builds preserve the buffer and prior graph. Saving advances the saved baseline. Node measurements never enter the graph document. Arrange results carry the draft they started from, so a late layout cannot replace a newer edit.

Save acknowledgements also carry the submitted rule. The reducer advances the server revision and saved baseline while preserving edits made after submission; a stale code build must not replace a newer buffer. Disabled controls communicate pending commands, but reducer checks enforce the draft contract independently of those controls.

Preview and published execution share a narrow request hook. Its key includes the graph/version and input buffer; changing either, rerunning, or unmounting invalidates the previous request. Only a current result may update the graph's trace or error locations. Example inputs, JSON-object parsing and cURL formatting live in `domain/executionInputs.ts`, so the API page does not import a test-panel component for data helpers.

Each source selection receives a session identity. Save responses update the source list and carry their source, selection and request identities. They cannot select another source or replace newer edits. Reopening the same source during its save can adopt the completed server revision while preserving any subsequent changes. Test responses additionally belong to the selected version and input buffer. Source reducers and buffer helpers stay free of React and network calls, allowing these race conditions to be tested as state transitions.

Async reads use a key describing the requested resource, an `AbortSignal`, and cleanup on selection changes/unmount. `semanticGraphKey` excludes positions: dragging a card changes the draft but does not refetch variables or diagnostics. A different expression or connection does. If a new consumer adds a query parameter, include it in the key; changing a loader closure alone does not refetch. Mutation commands remain explicit and serialize through the document controller.

Monaco providers are disposed on cleanup and restricted to their own model, so nested editors do not contribute duplicate suggestions to each other. The inspector registry must cover every `NodeType`. Reuse the existing value-binding controls for variable/constant/expression selection and string escaping.

`ExpressionField` keeps ordinary graph text inputs lightweight and lazy-loads `ExpressionDialog` on demand. That dialog reuses Code studio's catalog, insertion and Monaco providers, offering only in-scope variable names and no graph-module snippets. `/studio/expression/check` parses syntax and reports dependencies without evaluating values; the dialog cancels obsolete checks and preserves its caller's draft until Apply. Runtime type checks still belong to preview/execution.

## Design choices

The concrete SOLID applications are single-purpose services and forms, source strategies open to registration, substitutable repository/source contracts, narrow engine ports, and constructor-injected dependencies. The patterns used here are Repository, Strategy with a registry, Adapter, a request-scoped Decorator, and a reducer for document transitions. They address actual change points; there is no generic repository framework, event bus, or class hierarchy for every node.

These boundaries are maintenance rules, not a claim that every class is permanently complete. The expression parser and graph planner remain cohesive algorithms; split them when a new independent responsibility appears, not based on line count alone.

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
