---
name: arc-java
description: "Develop or change ARC Java/Spring Boot rules, execution, data sources, HTTP endpoints, and persistence. Use for backend implementation or backend-specific design; use arc-review for a review-only request."
---

# ARC Java development

Use [backend guidance](../../../backend/AGENTS.md) and the relevant section of [the maintenance guide](../../../docs/maintaining.md). Paths in commands are relative to the repository root.

## Workflow

1. Trace the request from its HTTP or engine entry point to the owning service, port and implementation. Read the affected tests. State the behavior being added or preserved; a structural change should identify the current coupling or duplicated policy it resolves.
2. Keep the change in the owner of that policy. A controller should not acquire a transaction or parse stored JSON because a service API is inconvenient. Extend an existing port when its capability changes; add a new port when consumers need an independent capability.
3. Make the decision path readable: validation, domain decision, side effects, result. Use explicit intermediate domain values when they clarify units, null handling or failure paths. Keep simple code local rather than inventing pass-through helpers.
4. Check the applicable invariants below and exercise the affected behavior. For a bug fix, prefer a test that fails for the reported input before the fix. For a refactor, preserve observable results, errors and side effects.
5. Review the diff for accidental contract changes, unnecessary APIs/dependencies, and stale callers. Report the extension point changed and the checks actually run.

## Extension decisions

| Task | Preferred seam | Evidence to preserve |
| --- | --- | --- |
| New external/local source kind | `SourceAdapter` plus configuration/UI support | Adapter discovery, typed inputs, null/missing values, version pins, failure policy |
| Storage change | `RuleRepository`/`SourceRepository` implementation | Revision conflicts, atomic publication, rollback and immutable versions |
| New function | Catalog metadata plus evaluator/Excel adapter | Supported status, arity, type errors and decimal semantics |
| New node behavior | Definition, planning, validation, evaluator and ARC Script together | Reachability, scopes, fan-out/joins, outputs and code/graph compatibility |
| HTTP change | Typed controller boundary and owning application service | Status, payload shape and structured error locations |

## Invariants to inspect when affected

- Save/publish locking and revision checking stay inside the write transaction; a failure must not partially publish.
- A rule reference resolves a specific version. Request caching uses both ID and version and never caches mutable drafts globally.
- Nested calls share execution/read limits. Validation and diagnostics may inspect source definitions but must not fetch HTTP values.
- Missing parameters, explicit nulls, caller overrides and fallback defaults stay distinct. Core decimal results must not silently pass through floating point.
- Provider replacements honor the same validation, value and error contract. Keep credentials out of saved definitions, traces and user-visible failures.

## Verification selection

Run the relevant JUnit tests, then `mvn -f backend/pom.xml verify` and `python3 scripts/check_architecture.py`. Use a clean build after class/package moves. For persistence or public endpoint changes, use the real PostgreSQL/API checks documented in [README](../../../README.md#development-and-verification), with a disposable database. Do not infer transaction correctness from mocked repository calls alone.

Upstream ideas and project-specific adaptations are recorded in [AI provenance](../../../docs/ai-sources.md).
