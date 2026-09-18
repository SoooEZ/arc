# Maintaining and extending ARC

ARC remains one React application and one Java application. The HTTP paths, graph JSON, ARC Script, published versions, database migrations, and execution semantics remain the public contracts. Start with [the graph contract](architecture.md) and [API reference](api.md) before changing them.

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

### Adding a data source

1. Implement `SourceAdapter` as a Spring component with a unique `kind()`, configuration validation, and `fetch(...)`. `SourceAdapters` discovers it through constructor injection and rejects duplicate kinds on startup. No dispatch branch is needed in `SourceService`.
2. Preserve strict typed input/default handling in `SourceService`; return the provider's JSON-compatible value. Field extraction stays in `JsonPointerExtractor`, and missing/fallback policy stays in `Parameters`.
3. If the provider needs new configuration, extend the portable `SourceDefinition`, frontend `SourceConfig`, source form, API specification, and ARC Script round-trip handling where applicable. Registering a strategy alone does not create its UI or storage contract. Unsupported-kind errors are generated from the registered kinds.
4. Test the adapter independently and add an API workflow for source creation, pinned versions, missing values and failures. For HTTP-based implementations, reuse the bounded transport and host/secret policy rather than creating an unrestricted HTTP client.

`SourceServiceTest` demonstrates an additional in-memory adapter without changing the service. Use that pattern for new providers. Use repository mocks for command ordering and rejected writes; real PostgreSQL smoke tests cover actual revision locks and transactions.

### Adding a function or node kind

For a function, update catalog metadata and its execution implementation, then test arity, types, edge cases, and a studio build/execution round trip. A reference-only entry must never advertise itself as executable. Monaco help and function chips use `/api/functions`, so they should not duplicate a handwritten function catalog.

A node kind changes the graph contract, not just a switch statement: review `Definition`, `Validator`, `GraphPlan`, `Engine`, `ArcScript`, frontend types, node defaults, the inspector registry, graph presentation, and documentation together. Add path/scope tests and a code/graph round trip. Existing node kinds deliberately remain explicit in the engine; a plugin hierarchy would hide the graph invariants without helping the current five kinds.

## Frontend boundaries

| Location | Responsibility |
| --- | --- |
| `api/` | Typed resource clients and injectable HTTP transport; status and graph error locations |
| `domain/` | Pure graph mutations, semantic identity, upstream variable choices, expression literals |
| `app/` | Hash navigation, dirty-document guards, library loading, sidebar and create dialog |
| `features/editor/documentState.ts` | Pure, atomic draft/code/trace state transitions |
| `features/editor/useRuleDocument.ts` | Save/build/publish commands, versions, dirty state and code synchronization |
| `features/editor/useGraphProblems.ts` | Static diagnostics, runtime errors and referenced-node error projection |
| `features/editor/useGraphCanvas.ts` | React Flow nodes, edges and UI measurements |
| `features/editor/inspector/` | Node-specific forms selected by an exhaustive node-type registry |
| `features/studio/` | Module snippets and shared Monaco insertion, completion and hover behavior |
| `features/sources/` | Source editor state and operations |
| `hooks/useAsyncResource.ts` | Debounced reads, abort/cleanup, stale-response suppression |
| `components/` | Reusable UI and page composition |

`api.ts` remains a compatibility facade over the resource clients. New controllers/hooks should import the relevant resource client. Pure domain functions and the document reducer must not import React, MUI, React Flow or network clients. They can be tested without mounting the editor or starting a server.

Graph and code edits share one document reducer. Building code updates the graph atomically; failed code builds preserve the buffer and prior graph. Saving advances the saved baseline. Node measurements never enter the graph document. Arrange results carry the draft they started from, so a late layout cannot replace a newer edit.

Async reads use a key describing the requested resource, an `AbortSignal`, and cleanup on selection changes/unmount. `semanticGraphKey` excludes positions: dragging a card changes the draft but does not refetch variables or diagnostics. A different expression or connection does. If a new consumer adds a query parameter, include it in the key; changing a loader closure alone does not refetch. Mutation commands remain explicit and serialize through the document controller.

Monaco providers are disposed on cleanup and restricted to their own model, so nested editors do not contribute duplicate suggestions to each other. The inspector registry must cover every `NodeType`. Reuse the existing value-binding controls for variable/constant/expression selection and string escaping.

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
