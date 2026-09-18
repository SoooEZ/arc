---
name: arc-react
description: "Develop or change ARC React/TypeScript/MUI editor features, graph and code synchronization, forms, hooks, and async UI behavior. Use for frontend implementation; use arc-review for a review-only request."
---

# ARC React development

Use [frontend guidance](../../../frontend/AGENTS.md) and [the frontend ownership map](../../../docs/maintaining.md). This is a Vite client application. Paths in commands are relative to the repository root.

## Workflow

1. Trace a user interaction through the component, feature controller, document transition and API boundary. Identify the authoritative state and the observable completion/failure behavior before changing ownership.
2. Implement pure decisions in the domain/reducer layer when they can be expressed without UI or IO. Keep event handlers as explicit actions and use effects for synchronization with external systems.
3. Shape the component API around valid states. Compose an independently useful region or extract an explicit variant when flags create incompatible combinations. Keep ordinary UI controls simple; do not add context solely to avoid one prop hop.
4. Handle pending, success, error, cancellation and selection changes for asynchronous operations. Check that stale work cannot overwrite a newer draft, version or selection. A response-dependent query key must include every relevant input.
5. Test the transition at the lowest meaningful level and test the actual user workflow when UI behavior changed. Inspect the diff for unnecessary rerenders/requests, leaked listeners, hidden casts, and code/graph divergence.

## ARC-specific checks

- Reuse the document reducer for graph/code edits. A failed build retains the text buffer and prior graph. Saving advances the saved baseline only after success.
- A late layout or render cannot replace newer edits. Measurements and selection stay UI-only; saved node positions stay part of the portable graph.
- Diagnostics and available-variable reads use semantic graph identity. Moving a card alone should not create network traffic for those reads.
- Use the shared variable/constant/expression controls. Typed string constants must be escaped once; code mode still uses explicit literals.
- Reference dialogs keep the parent draft and error path. Nested references stay in the same modal with Back and Close all.
- Monaco completion/hover providers are model-scoped and disposed. Large optional editor/layout modules stay lazy; measure before adding memoization or replacing state ownership.
- Node kinds update the exhaustive form registry, defaults and graph/code representations together.

## Verification selection

Run `npm --prefix frontend run format:check`, `npm --prefix frontend run test:unit`, `npm --prefix frontend run build`, and `python3 scripts/check_architecture.py`. Add or run the browser workflow that exercises the changed interaction, using [the disposable stack instructions](../../../README.md#development-and-verification).

For async edits, exercise a slow old response followed by a newer edit. For component extraction, check focus/keyboard behavior and the relevant narrow viewport. Unit tests that reproduce a helper's implementation are not substitutes for draft-preservation or user-visible assertions.

Upstream ideas and project-specific adaptations are recorded in [AI provenance](../../../docs/ai-sources.md).
