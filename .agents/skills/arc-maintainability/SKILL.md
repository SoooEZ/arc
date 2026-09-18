---
name: arc-maintainability
description: "Refactor or design ARC modules for readability, maintainability, and extensibility while preserving behavior. Use for requested cleanup, SOLID/design-pattern work, reducing coupling, or choosing an extension boundary; not for routine wording or style-only edits."
---

# ARC maintainability refactoring

Read [module ownership](../../../docs/maintaining.md) and the affected [Java](../../../backend/AGENTS.md) or [React](../../../frontend/AGENTS.md) guidance. Use the current task and repository behavior to choose scope; do not expand a focused fix into a project-wide rewrite.

## Make the maintenance problem concrete

Identify the repeated change, hidden dependency, invalid state or confusing control flow that makes this code difficult to modify. Record the public behavior that must survive. When the task is broad, prioritize modules with mixed responsibilities or repeated policy, and make each change independently reviewable. Routine refactoring does not require a separate design document or user approval.

## Choose the smallest useful boundary

| Signal | Decision to consider | Reject when |
| --- | --- | --- |
| UI/persistence/HTTP mixed with a domain decision | Pure function or focused application service | The extraction merely renames a one-line call |
| Multiple real implementations of one capability | Existing port, Strategy or Adapter | The only proposed variants are hypothetical |
| Repeated domain policy across callers | Shared named operation | Callers only look similar but have different semantics |
| One component owns unrelated state lifecycles | Feature controller, reducer, or composed region | The change scatters tightly coupled state among wrappers |
| Independent boolean flags allow invalid combinations | Explicit variants or a discriminated union | The flags represent genuinely independent controls |
| Complicated transformation hides business meaning | Named intermediate values or a plain loop | Shorter syntax is the only claimed benefit |

## Apply SOLID as observable constraints

- **Single responsibility:** name the policy owned by the module and the change that should no longer affect it.
- **Open/closed:** use real extension seams such as ARC source strategies; document what a new implementation must provide. Stable graph semantics may remain explicit in the evaluator.
- **Substitutability:** preserve results, failure behavior, nullability, order, transaction assumptions and bounds when replacing an implementation.
- **Interface segregation:** expose only the capability the consumer needs. Avoid handing an engine the full persistence/application service.
- **Dependency inversion:** keep core decisions dependent on narrow contracts. Construct infrastructure at the application boundary; avoid service locators and hidden global state.

These are design criteria, not a requirement to introduce five patterns. Existing Repository, source Strategy/registry, Excel Adapter, resolver Decorator and document reducer are the default extension seams.

## Preserve behavior during the change

Inspect callers and tests before moving code. Use characterization tests where material behavior lacks coverage, then migrate a coherent responsibility and its callers together. Keep serialization, errors, evaluation order, rounding and side effects stable unless the user requested a behavior change. Run affected checks after each meaningful stage; broadening tests should follow actual risk or a failure.

Check the resulting code with a concrete next change, such as adding a source provider or another node form: which files would change, and why? Do not implement that hypothetical feature merely to justify the abstraction. Remove obsolete paths and document the chosen seam when it changes how future work is done.

## Completion evidence

Explain what responsibility moved, why the new boundary helps, which observable behavior was tested, and any remaining limitation. Line counts and the number of interfaces are not quality evidence by themselves. Use the verification matrix in [root guidance](../../../AGENTS.md), scaled to the change.

See [AI provenance](../../../docs/ai-sources.md) for curated influences; this workflow is tailored to ARC's current contracts.
