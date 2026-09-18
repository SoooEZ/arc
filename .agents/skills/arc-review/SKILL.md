---
name: arc-review
description: "Review ARC code changes or an identified module for concrete regressions, architecture violations, and actionable maintainability problems. Use when a code review or quality assessment is requested; review-only work does not authorize edits or posting comments."
---

# ARC code review

Use [root review rules](../../../AGENTS.md), the affected subtree guidance, and [the graph contract](../../../docs/architecture.md). Keep the review focused on the requested diff or module. If no range is given, inspect repository status and the current diff; ask for a target only when none can be inferred.

## Review method

1. Establish the changed behavior and affected callers. Read the surrounding implementation and relevant tests rather than judging an isolated patch.
2. Trace correctness and data flow before commenting on style. Check applicable ARC invariants below. Reproduce a suspected failure with an existing test or a small, non-destructive check when useful.
3. Separate actionable bugs from maintainability suggestions. A finding needs a location, triggering input/change, consequence, and a concrete fix direction. Explain uncertainty when evidence is incomplete.
4. Check that validation matches the risk: mocks cannot prove database transactions, a build cannot prove race handling, and snapshots alone cannot prove editor state preservation.
5. Report the findings with file/line references and verification limits. If there are no findings, say so; do not invent issues to fill a quota or equate a clean review with guaranteed correctness.

## ARC invariants by affected area

| Area | Trace |
| --- | --- |
| Rule commands/storage | Revision conflicts, atomic publication/rollback, immutable version pins |
| Evaluation | Fan-out/joins, branch-sensitive scope, one/multiple Outputs, numeric/null semantics, shared limits |
| Sources | Caller override, missing versus null, default policy, pinned config, HTTP bounds and destination policy |
| Editor | Unsaved buffer preservation, graph/code round trips, stale results, semantic request keys |
| UI integration | Error-to-node navigation, nested reference modal history, provider/listener cleanup, keyboard/focus behavior |
| Boundaries | Engine isolation, JDBC ownership, pure frontend state, typed API errors |

Only apply checks touched by the change. Intentional existing choices such as open API access and the use of JDBC are context, not new defects in every review.

## Maintainability findings need a cost

Show a duplicated policy that can drift, an invalid state that callers can create, a hidden dependency, or a foreseeable change spread across unrelated modules. Recommend a focused boundary or clearer control flow. Do not flag a long cohesive algorithm, absent interface, valid direct call, or missing memoization without explaining an actual problem. Leave formatting to the configured formatter.

For bugs, report severity according to impact and reachability. For optional improvements, label them as suggestions and keep them separate. A review-only request stays read-only; apply fixes or publish external comments only when that work is authorized by the user.

Upstream ideas and project-specific adaptations are recorded in [AI provenance](../../../docs/ai-sources.md).
