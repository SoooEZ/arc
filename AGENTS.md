# ARC engineering guidance

ARC is a React/TypeScript/MUI editor and a Java/Spring Boot rule and calculation service backed by PostgreSQL. Use the versions in the build files. User instructions take precedence over these project conventions.

## Start with the affected boundary

Read [the maintenance guide](docs/maintaining.md) for module ownership. Before changing backend or frontend code, also read that subtree's [backend guidance](backend/AGENTS.md) or [frontend guidance](frontend/AGENTS.md), including when the task starts at the repository root. Read [the graph contract](docs/architecture.md) when changing evaluation, scope, or serialization.

Before implementation, refactoring or review, read the applicable [review lessons](docs/review-lessons.md) and inspect their linked regression tests. Use the documented trigger and preventive rule to guide the change; retain the observable assertions. When a new material regression is confirmed, update the relevant lesson and its test reference rather than adding duplicate generic advice.

Choose only the skills relevant to the task:

- Java implementation: [arc-java](.agents/skills/arc-java/SKILL.md).
- React implementation: [arc-react](.agents/skills/arc-react/SKILL.md).
- Structural refactoring or design: [arc-maintainability](.agents/skills/arc-maintainability/SKILL.md).
- Requested review: [arc-review](.agents/skills/arc-review/SKILL.md).

These are project-local instructions. They do not authorize extra dependencies, deployments, external comments, or unrelated rewrites. Work within the user's requested outcome; resolve routine implementation choices without creating an approval step.

## Contracts that refactoring must preserve

- HTTP payloads/statuses, graph JSON, ARC Script round trips, and existing published versions are compatibility boundaries. Make intended behavior changes explicit and test their callers.
- Pinned references remain immutable. Draft save and publish retain revision checks and atomic transactions. Leave applied Flyway migrations unchanged; schema changes use a new migration.
- Fan-out, joins, branch-sensitive variables, and multiple Outputs follow the graph contract. One reached Output returns its value; multiple reached Outputs return an object keyed by node ID.
- The browser's graph and code views share one draft. Failed builds and late async work must not erase newer edits. Error locations must remain navigable through referenced rules.
- Keep decimal arithmetic, explicit null versus missing input, source overrides/fallbacks, and shared execution limits intact. Static diagnostics must not fetch external data.

## Readability and extension decisions

- Name domain operations and values explicitly. Keep units, nullability, side effects, and error handling visible. Prefer a short loop to a dense stream/ternary chain when it explains the rule more clearly.
- Extract around ownership or a real reason to change. Before adding an interface, registry, or hook, identify the capability it isolates and the caller that benefits. Keep cohesive algorithms together.
- Reuse existing extension points before inventing parallel ones. Similar syntax alone does not justify a shared abstraction; do not force unrelated behaviors behind flags or a generic `utils` module.
- Comments explain constraints or tradeoffs. Remove dead paths when their callers have been migrated. Preserve tests that check behavior; do not weaken assertions or disable checks to finish a refactor.

## Verification

Run checks proportional to the changed behavior. All commands below run from the repository root; see [setup and disposable integration environments](README.md#development-and-verification).

| Change | Checks |
| --- | --- |
| Java or cross-module dependencies | `python3 scripts/check_architecture.py`; `mvn -f backend/pom.xml verify` with Java 21 |
| Frontend logic/UI | `python3 scripts/check_architecture.py`; `npm --prefix frontend run format:check`; `npm --prefix frontend run test:unit`; `npm --prefix frontend run build`; affected Playwright workflows |
| API/storage/evaluation or graph/code integration | Relevant checks above plus `scripts/smoke.py`, `scripts/studio_smoke.py`, and affected browser tests against a disposable stack |
| Instructions/docs only | Validate skill metadata and local links; inspect examples against real paths/commands. App rebuilds are unnecessary unless runtime/build files also change. |

Live smoke/browser tests write fixtures: use a separate Compose project and ports, not the user's working database. Report which checks ran and their results; distinguish static validation from exercised behavior.

## Code Review Rules

Prioritize reproducible regressions, data loss, compatibility changes, dependency violations, and missing tests for material behavior. Trace the affected caller and give a concrete trigger and consequence. Label optional maintainability suggestions separately from bugs. Avoid arbitrary file-length limits, speculative performance claims, and demands for a pattern without a demonstrated need.

See [AI usage and provenance](docs/ai-quality.md) for invocation examples, scope, and the upstream references used to curate these conventions.
