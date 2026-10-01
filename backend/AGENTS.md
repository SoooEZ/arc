# Java backend guidance

Applies to `backend/`. Read [root guidance](../AGENTS.md) and [module boundaries](../docs/maintaining.md). Use [arc-java](../.agents/skills/arc-java/SKILL.md) for implementation and [arc-maintainability](../.agents/skills/arc-maintainability/SKILL.md) for structural changes.

Read the applicable [backend/serialization failures](../docs/review-lessons.md#backend-and-serialization-failures) and [contract guards](../docs/review-lessons.md#maintainability-lessons-and-contract-guards) before changing those paths. They record concrete arithmetic, literal, HTTP-policy, size-limit and ownership mistakes with existing regression coverage.

## Ownership

- `api` translates HTTP; `rule` coordinates commands/checks/execution; `engine` evaluates portable definitions; `source` handles provider contracts; `persistence` implements repository ports. Follow the dependency map in the maintenance guide.
- Controllers call application services. A transformation that touches no storage, such as `engine.script.ArcScript` rendering or building code and `Functions.catalog()`, may be called through its stateless engine facade, as the dependency map allows; do not add a service that only forwards to it. SQL and JSONB persistence belong in JDBC adapters. Keep the existing `JdbcTemplate` approach unless changing storage is part of the task.
- Use constructor injection and final dependency fields. Execution code receives the narrow `RuleResolver`/`SourceReader` capabilities, not an application service or JDBC connection.
- Keep singleton services stateless. The memoized resolver and source-read budget are created per execution and shared with nested rule calls; they must not become a global cache or reset for each child. The process-wide caches hold only immutable versions: the engine's compiled published plans with their source-contract verdicts, and the frozen source versions of `SourceVersions`.

## Data and behavior

- `RuleService`/`SourceService` own write transactions. Preserve lock, revision check, validation and publication ordering, including rollback and conflict behavior.
- Treat `Definition`, source definitions, stored versions and error locations as serialized contracts. Typed records at boundaries are preferred when the structure is known; dynamic expression results remain dynamic.
- Requests are read strictly and stored JSON leniently (`JsonCodec.decode`): an unknown request field is a `400` naming its path, while a field a later model drops never makes a stored version unreadable. A test that builds its own `ObjectMapper` does not see the application's settings, so test request parsing through the web layer.
- Keep core arithmetic in `BigDecimal`; POI conversion stays in `ExcelFunctionAdapter`. Avoid implicit coercion, rounding changes, and conflating absent input with explicit null. Turn scalars into text or keys with `ValueText`, never `BigDecimal.toString()`, and read shared sizes and budgets from `engine.Limits` instead of retyping them.
- Classify failures by `ArcException.Kind`. Fallbacks (`IFERROR`, source `DEFAULT`, field/case context) test `recoverable()`, never an HTTP status or message text; a new request-wide budget throws `ArcException.limit`.
- Node kinds and handles come from `model.NodeKind` and `Handles`. Per-kind behavior is an exhaustive switch expression without a `default` branch; the architecture script rejects node-type and handle strings elsewhere.
- Register new providers through `SourceAdapter`. Extend configuration and bindings where necessary; preserve host policy, deadlines, limits, and JSON Pointer behavior for HTTP sources. Do not introduce automatic retries or global caching as incidental refactoring.
- Describe an interface's behavioral contract before replacing its implementation: null behavior, thrown errors, transaction requirements, ordering, and limits all matter for substitutability.
- Avoid catch-and-ignore, deep stream pipelines, and interfaces that merely duplicate one class without isolating a real boundary. Use domain names and explain non-obvious invariants near the responsible code.

## Verification

From the repository root, use `mvn -f backend/pom.xml spotless:apply` to format intentional changes and `mvn -f backend/pom.xml verify` to check them. Run `python3 scripts/check_architecture.py`. Changes to package/class names should use a clean build to remove stale Spring beans.

Use JUnit/AssertJ for evaluator behavior and Mockito for command collaboration where it matters. Build test nodes with `support/GraphFixtures`, not positional `Node` constructors. Exercise persistence/transaction changes against real PostgreSQL through the disposable integration workflows in [README](../README.md#development-and-verification). Test inputs, observable results and failure effects; avoid tests tied only to private helper structure.

## Code Review Rules

Check revision conflicts, immutable pins, transaction rollback, source limits, null/default handling, branch merges, and nested error locations when those paths change. Existing open API access is an intentional current product choice, not a newly introduced regression in every change.
