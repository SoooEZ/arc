# React frontend guidance

Applies to `frontend/`. Read [root guidance](../AGENTS.md) and [frontend boundaries](../docs/maintaining.md). Use [arc-react](../.agents/skills/arc-react/SKILL.md) for implementation and [arc-maintainability](../.agents/skills/arc-maintainability/SKILL.md) for structural changes.

Read the applicable [frontend failures](../docs/review-lessons.md#frontend-failures) and [serialization failures](../docs/review-lessons.md#backend-and-serialization-failures) before changing those paths. They record concrete async, read-only, version, row-identity, mapping, animation and escaping mistakes with existing regression coverage.

## Ownership and state

- ARC uses React, TypeScript, Vite, MUI, React Flow and Monaco. Select guidance appropriate to this client application; Next.js server components/actions and server caches are not part of its runtime.
- Keep resource paths and HTTP errors in `src/api/`, pure graph/expression logic in `src/domain/`, and feature orchestration in `src/features/`. Components present state and emit domain actions.
- Treat `documentState.ts` as the owner of draft/code transitions. Maintain one authoritative draft; derive values instead of synchronizing duplicate state with effects. Keep React Flow measurements and selection out of persisted definitions.
- Model states and actions with precise TypeScript types. Prefer explicit variants or composition when independent boolean props produce invalid combinations. A simple two-state control does not need an elaborate component family.
- Keep side effects at a clear boundary. Resource identity includes every value that changes the response. `useAsyncResource` keys drive reads; merely changing a loader closure does not refetch.
- Cancel obsolete reads and ignore late results. Mutations need explicit pending/error behavior and must preserve unsaved edits. Position-only edits do not invalidate variable/diagnostic semantics.

## Readable UI and extensions

- Put node-specific forms in the exhaustive inspector registry and keep expression escaping in the shared value-binding/domain helpers. Add new node kinds across types, defaults, presentation and code round trips together.
- Keep component/hook names tied to their capability. Extract substantial decisions from JSX; avoid nested ternaries and wrappers that only hide prop forwarding. Use readable local names instead of cast chains or `any` to satisfy the compiler.
- Reuse MUI conventions for labels, keyboard/focus behavior and dialogs. Changes to referenced-rule navigation must preserve the parent draft and the Back/Close all behavior.
- Monaco providers/listeners belong to one editor/model and must be disposed. Retain lazy loading for large optional features. Add memoization or a new state library only for a demonstrated need, and include the relevant dependencies rather than hiding stale closures.

## Verification

From the repository root, run `npm --prefix frontend run format:check`, `npm --prefix frontend run test:unit`, `npm --prefix frontend run build`, and `python3 scripts/check_architecture.py` for frontend logic changes. Use `npm --prefix frontend run format` for intentional formatting.

Pure tests cover document transitions, graph helpers and the HTTP boundary. Browser workflows cover actual editor behavior; run affected cases against a disposable stack, following [README](../README.md#development-and-verification). For async changes include a late-response/selection-change case, not only the immediate success path.

## Code Review Rules

Look for lost drafts, stale validation, incorrect variable choices, invalid Hook dependencies, leaked editor providers, and graph/code divergence. Performance findings need an observable request/render/bundle consequence; line count or the absence of `useMemo` alone is not a bug.
