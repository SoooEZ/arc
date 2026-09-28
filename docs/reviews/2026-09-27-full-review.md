# Full-project review and fixes — 2026-09-27

## Scope and method

The user asked for a full-project code review of the frontend and backend, then asked to fix every finding (全修), with the goal of modular, readable, reusable, extensible and human-readable code on both sides. The baseline is `main` at `49bb365`, a clean tree. There is no diff under review: the whole codebase at that commit is the subject. Correctness came first; maintainability findings were secondary but in scope for the fixes.

The review used many independent angles. 24 finder passes each read the code from one angle: correctness per area (expressions and Excel, execution and graphs, validation and ARC Script, sources and HTTP, the editor document, inspector, studio and application shell), cross-boundary data flow, reuse and cleanup, structure ("altitude"), backend and frontend efficiency, and a final sweep. Findings needed a concrete trigger and consequence; most were confirmed with a probe (Java against the baseline build, pure TypeScript specs, or Chromium against the built bundle). Duplicates were merged into one registry of 116 findings, and the sweep added 5 more.

Every correctness and sweep finding was then verified independently by one of 19 verification passes. A verifier re-derived the mechanism from the code instead of trusting the finder's probe, reran or wrote its own probe where feasible, and returned CONFIRMED, PLAUSIBLE (real mechanism, uncertain trigger) or REFUTED (wrong, guarded elsewhere, or documented as intended), with a quote and a severity. Cleanup, structure and efficiency findings were checked by the package that fixed them; efficiency fixes were measured before and after.

The fixes ran in phases. Packages worked in isolated worktrees and ran browser and live API checks on their own disposable Compose stacks:

1. **Foundation.** Shared contracts that several fixes needed: typed error kinds, `Limits`, `ValueText` and `Identifiers.isResourceId` on the backend; the lossless JSON codec, ID generation, own-key lookups, the navigation guard registry, `LazyBoundary` and the shared function catalog on the frontend.
2. **Ten packages by ownership:** backend execution, sources, API/persistence, validation/ARC Script and expressions; frontend data/transport, inspector, studio, editor and application shell.
3. **Integration** of the packages and their cross-package requests.
4. **Three structural refactors** that preserve behavior: backend node kinds, immutable model and narrow ports; the frontend node-kind descriptor and command gate; CSS tokens and the cascade cleanup.

Each code fix has a regression test that fails before the fix; the web-server settings were checked with curl against the built image instead. Existing assertions were not weakened; where a test asserted the old defect, the change is justified in the package report. Intended behavior changes were recorded explicitly and are listed in the [API](../api.md#behavior-changes-in-this-revision) and [studio](../studio.md#behavior-changes-in-this-revision) guides. The reusable rules are in [the review lessons](../review-lessons.md) as F18–F35, B7–B25, new contract guards and extensions of earlier rows.

## Summary

| Category | IDs | Findings | Verification | Fixed | Partly fixed | Not changed |
| --- | --- | ---: | --- | ---: | ---: | ---: |
| Backend correctness | K01–K28 | 28 | 27 confirmed, 1 plausible | 28 | 0 | 0 |
| Frontend correctness | K30–K63 | 34 | 32 confirmed, 1 plausible, 1 refuted | 33 | 0 | 1 |
| Sweep | SW1–SW5 | 5 | 3 confirmed, 2 plausible | 5 | 0 | 0 |
| Cleanup | C01–C24 | 24 | Checked by the fixing package | 24 | 0 | 0 |
| Efficiency | E01–E07, E11–E18 | 15 | Measured by the fixing package | 14 | 1 | 0 |
| Structure (altitude) | A01–A07, A11–A18 | 15 | Checked by the fixing package | 12 | 3 | 0 |
| **Total** | | **121** | | **116** | **4** | **1** |

Verifiers rated four findings high severity (K01, K02, K16, K30) and 18 medium; the other confirmed or plausible findings are low. K63 was confirmed in the browser by the package that fixed it. K38 was refuted: re-pinning a Reference to another version deliberately resets its bindings, and the existing picker test asserts that behavior.

## Headline findings

1. **HTTP sources reached private networks through IPv6 answers (K16, high).** A DNS AAAA answer such as `::ffff:169.254.169.254` came back from the JDK as an `Inet6Address` whose loopback, link-local and site-local predicates are all false, so a source Test could reach cloud metadata, localhost or the private network and return the body. NAT64, 6to4 and IPv4-compatible forms passed the same way. **Fix:** `BlockedAddresses` classifies raw address bytes against explicit IANA ranges and judges IPv6 forms that embed IPv4 by that address; every other IPv6 address outside global unicast is blocked. Lesson [B20](../review-lessons.md#backend-and-serialization-failures).
2. **Excel calls escaped every ARC bound (K01 high, K04 medium).** Wildcard criteria in `COUNTIF`, `SUMIF`, `MATCH`, the lookups and the `D*` functions became backtracking regexes that the deadline never interrupted: a 60-byte preview request pinned a request thread and a CPU core far past its deadline (extrapolated to years). `$TEXT` also filled POI's static formatter cache with every distinct format and ran out of memory under a small heap. **Fix:** `ExcelWildcards` replays POI's pattern on metered text and rejects a call past 10,000,000 character reads before POI runs; `ExcelText` formats per call without static caches. Lessons B14 and B15.
3. **Error functions hid exhausted shared budgets (K02, high).** Once Formula calls ran inside expressions, `$IFERROR` and the `$IS…` functions caught the 422 step, nesting, source-read and operation budgets, so `$SUM($MAP(items, x, $IFERROR(@one:1(), 0)))` returned a truncated total with `200`. **Fix:** `ArcException.Kind`; only `INVALID` and `NOT_AVAILABLE` are recoverable, and every fallback tests `recoverable()`. Lesson B7.
4. **Graph edits crashed on plain-HTTP origins (K30, high).** `crypto.randomUUID` exists only in secure contexts; opening the documented plain-HTTP deployment by LAN address and connecting two nodes threw inside the document reducer and blanked the app with the draft. **Fix:** `domain/ids` generates IDs with `crypto.getRandomValues`, chosen in event handlers. Lesson [F18](../review-lessons.md#frontend-failures).
5. **Leaving during Publish still published the discarded draft (K58, medium).** Validate, save and publish ignored the editor session, so after the user confirmed "discard", the draft was saved and published as a new immutable version. **Fix:** every request takes the session signal and checks it after each await; a pending save or publish registers a navigation guard scoped to leaving the rule. Lesson F3.
6. **Joins treated skipped-branch writes as sequential (K09, medium).** Supersession came from static ancestry, so a write linked to an earlier one only through a branch that was not taken silently won: a non-member received the member price. **Fix:** `ExecutionScope` records the write each producer replaced on the path that ran; independent writes conflict at the join. Lesson B8.
7. **The code view invented code for unfinished drafts (SW3 + K18, medium).** The renderer turned a missing `when` into `when true;` and a missing Output into `return null;`, so a draft that validation rejected became publishable with fabricated logic after the next build; empty names rendered as unparseable text. **Fix:** the renderer writes only what the draft holds (`return;`, `when;`, `let total;`, `use "rule-id";`) and the parser accepts exactly those forms; complete graphs render byte for byte as before. Lesson B12.
8. **Numbers were rounded through JavaScript doubles (K32, medium).** Every response and JSON buffer went through `JSON.parse`, so `9007199254740993`, 20-digit lookup entries and 34-digit decimals were rounded into saved drafts and immutable source versions, and `1e400` became `null`. **Fix:** the lossless codec in `domain/json` for HTTP bodies, editable buffers and displays. Lesson B6.
9. **The Java body limit could be bypassed (K17 + K27, medium).** The filter checked the raw URI, so `/api;x=1/…` and `/%61pi/…` skipped the 1 MiB cap on the direct port, and it ran after Spring's form parser, which read whole PUT/PATCH/DELETE form bodies first. **Fix:** every body is capped first, whatever the method or path, and form parsing is disabled. Lesson B23.
10. **Numbers became exponent text (K03, medium).** `BigDecimal.toString()` in `$CONCAT`, `$CONTAINS`, `$GET`, lookup keys and HTTP parameters turned values such as `$YEAR(date)` into `2.02E+3` and silently missed lookup entries. **Fix:** `ValueText.text` and `ValueText.key` everywhere, plain POI results, pointer selection without re-serialization, and plain JSON output. Lesson B17.
11. **A new node reused a live result variable (K33, medium).** Result names came from the node count, so after a deletion a new node repeated an existing name and silently changed results or failed at joins. **Fix:** `createGraphNode` uses `uniqueName` over every input and result. Lesson F19.
12. **Node names such as `constructor` blanked the editor (K60, medium).** Plain-object lookups keyed by user-chosen names read `Object.prototype` members, and the render then called array methods on a function. **Fix:** `Map`/`Set`, `ownValue` and `withBinding` wherever names are user-chosen. Lesson F22.
13. **Browser Back discarded the embedded source manager (K49, medium).** The dialog guarded only its own Close and page unload, so Back or a view switch dropped unsaved source edits without a prompt. **Fix:** the navigation guard registry; the workspace consults every guard for in-app navigation, `hashchange` and `beforeunload`. Lesson F23.
14. **A failed lazy chunk blanked the application (SW1, medium).** Eight `React.lazy` boundaries had no error boundary, so a redeploy or network drop unmounted the root and lost the draft with its unload guard. **Fix:** `LazyBoundary` at every lazy site, a lazy editor route, `RecoverableBoundary` at the root and around the routed view, a save-then-reload notice on `vite:preloadError`, and `404` for missing assets. Lesson F20.
15. **Arrays reached Excel functions as one fixed cell (K05, medium).** POI evaluated at cell (0,0), so `$SQRT([4, 9])` returned 2 and `$ROWS([])` returned 1. **Fix:** POI's parameter metadata decides where arrays are allowed, and empty ranges have defined results. Lesson B16.

## Other findings by area

Status "Fixed" means the change is in the integrated tree: correctness fixes carry a regression test, and efficiency fixes a before/after measurement. The lesson column names the failure row or [contract guard](../review-lessons.md#maintainability-lessons-and-contract-guards) in the review lessons.

### Backend: expressions and Excel

| ID | Finding | Status | Lesson |
| --- | --- | --- | --- |
| K06 | Nested array/object equality used `Objects.equals`, so `[1] == [1.0]` depended on number types | Fixed: one `Expressions.equal` | B18 |
| K07 | Quoted-token regexes recursed per character; long literals overflowed the stack (`500`) in the expression parser and the Script scanner | Fixed: possessive patterns | B13 |
| K08 | `$TEXT`/`$DOLLAR` followed the JVM locale (plausible) | Fixed: POI pinned to en-US and UTC; the Docker JVM runs en-US | B15 |
| K10 | Formula calls bounded a child's multi-Output aggregate that a Reference accepted | Fixed | B19 |
| C19, A01 | Error kinds derived from status literals and `#N/A` substrings | Fixed: `ArcException.Kind` | B7 |
| A02 | No single value-to-text formatter | Fixed: `ValueText` | B17 |
| C21 | Dead eager `AND`/`OR`; duplicated function name tables | Fixed: one dispatch table per evaluation style | Contract guard "Function help" |
| E12 | Collection items copied the whole scope | Fixed: `$MAP` over 151 variables 1.37 → 0.11 ms | — |
| E13 | Value bounds took the slow `doubleValue` path | Fixed: 34-digit bound 338–641 ns → 10–12 ns | — |

### Backend: execution and graph

| ID | Finding | Status | Lesson |
| --- | --- | --- | --- |
| K11 | Source reads, the `sources` list and the first failure followed per-JVM hash order | Fixed: declaration order | B9 |
| K12 | Cycle errors marked a node downstream of the cycle | Fixed | B10 |
| C20 | Per-run state threaded through every helper | Fixed: `RuleRun`, `Resolution` | Contract guard "Ambient evaluation state" |
| A05 | Returned values should be bounded once, at rule exit | Fixed with K10 | B19 |
| E16 | Scopes merged and copied per node | Fixed: 100-node chain 478 → 74 µs, 32 diamonds 924 → 205 µs; trace bytes identical | — |
| E17 | The root pin was read and decoded before the plan cache | Partly fixed: cached plans skip the read; the source-contract walk still re-reads child pins | Contract guard "Ambient evaluation state" |

### Backend: validation, diagnostics and ARC Script

| ID | Finding | Status | Lesson |
| --- | --- | --- | --- |
| K13, K14, K22, A03 | One fault reported twice or without its label; source-contract checks repeated graph checks | Fixed: one enumeration, one labelling check, `Problems` | B11 |
| K15 | Connection shape errors located at the Input node | Fixed: `ShapeViolation` | B11 |
| K28, A06 | Generated edge IDs exceeded 100 characters or collided | Fixed: bounded IDs with a digest; `ScriptLocations` | B5 |
| C01 | Dead `ArcScript.checkExpression` diverged from the endpoint | Fixed: removed | — |
| E15 | Diagnostics compiled each expression two or three times | Fixed: `ExpressionCache`; 4.3 → 2.0 ms per call | B11 |

### Backend: sources and HTTP

| ID | Finding | Status | Lesson |
| --- | --- | --- | --- |
| K19 | Oversized and non-2xx bodies were drained on close | Fixed: cancel before close | B21 |
| K20 | The configured query was re-encoded when parameters were added | Fixed | B21 |
| K26 | A null secret-header value in a LOOKUP definition failed every execution with `500` | Fixed | B22 |
| E18 | JSON Pointer re-serialized the response through `JsonNode` | Fixed; scale kept | B17 |
| C03 | Hard-coded "HTTP or LOOKUP" message | Fixed: from the registry | — |
| C07, C17 | Deadline-less `fetch`/`read` overloads; the service implemented `SourceReader` | Fixed: one deadline-aware method each | Contract guard "provider" |

### Backend: API, persistence and configuration

| ID | Finding | Status | Lesson |
| --- | --- | --- | --- |
| K21 | A duplicate source ID was reported as "This rule ID already exists" | Fixed: repositories translate duplicates | B24 |
| K25 | Versions of an unknown source returned `200 []` | Fixed: `404` | B24 |
| K23 | The `preview` sentinel collided with a legal rule ID | Fixed on the client: preview roots need a null version (`isPreviewRoot`) | Earlier fix "Error navigation" |
| C02, C04, C05 | Timeout, expression-length and slug literals copied across classes | Fixed: `ExecutionDeadline`, `Limits`, `Identifiers.isResourceId` | B5 |
| C06 | Paging and search copied into services, controllers and repositories | Fixed: `PageRequest`, `PageParameters`, `CatalogPages`; `SourceRepository` still takes primitive offset and limit | Contract guard "Catalog paging" |
| E11 | Rule summaries computed JSONB counts for every matching row | Fixed: page-first query; rules 336 → 3.1 ms, sources 86 → 1.6 ms | Contract guard "Catalog paging" |
| E14 | Startup loaded every rule to test emptiness | Fixed: `EXISTS`; 508 → 0.3 ms | Contract guard "Catalog paging" |
| — | U+0000 text failed with `500`; API numbers used exponent notation | Fixed: `StoredText` (`422`); plain JSON numbers | B24, B17 |

### Frontend: editor document, canvas and Test panel

| ID | Finding | Status | Lesson |
| --- | --- | --- | --- |
| K34, A18 | Preview identity included positions; dragging cleared the result | Fixed: `semanticGraphKey`; no shared request-slot helper (deliberate) | F3 |
| K37 | API drafts without positions crashed the reducer | Fixed: `withNodePositions` | F15 |
| K41 | Version history did not refresh after publish | Fixed | F5 |
| K44, A13 | Arrange awaited the viewport fit inside the command lock | Fixed: fit request in canvas state | F8 |
| K46 | The Test panel lost inputs and results between views | Fixed: `usePreviewExecution` | F25 |
| K47 | Deleting a node while its lazy dialog loaded locked the inspector | Fixed: `useNodeDialog`, `LazyNodeDialog` | F6 |
| K48 | Export revoked its URL right after the click (plausible, Safari) | Fixed: revoked after 40 s | F35 |
| K55 | The selected node was never reconciled with the draft | Fixed: `nodeSelection.ts` | F5 |
| K57 | Save acknowledgements replaced the draft with the server echo | Fixed: `sameDefinition` | F1 |
| K59 | A self-reference location was treated as local | Fixed: `isCurrentGraphLocation` | Earlier fix "Error navigation" |
| A14 | The untouched-sample rule was restated per panel | Fixed: `useInputBuffer`; sources keep their reducer flag | F25 |
| E03 | Any node change rebuilt every React Flow element and re-routed every edge | Fixed: `flowElements.ts`, geometry-keyed routing | — |
| E05 | Clearing runtime problems caused a second render per keystroke | Fixed | — |
| C11, C13, C22, C24 | Restated delete/result rules, effect-mirrored preview results, a MiniMap cast, non-null assertion chains | Fixed | — |

### Frontend: inspector and value bindings

| ID | Finding | Status | Lesson |
| --- | --- | --- | --- |
| K31, K45, A12 | Constant edits and the Condition builder swapped editors mid-entry | Fixed: `useEditingPin` | F13 |
| K40 | Literal classifiers accepted `.5e3`, `1.` and other text the server rejects | Fixed: server-verified literal table | F16 |
| K51 | Stored invalid names could not be shortened | Fixed: `acceptsIdentifierEdit` | F28 |

### Frontend: code studio, completion and playground

| ID | Finding | Status | Lesson |
| --- | --- | --- | --- |
| K35 | Reuse node IDs exceeded 80 characters for long rule IDs | Fixed: `reuseNodeId` | B5 |
| K36 | Outline navigation matched comments and other-case IDs | Fixed: `scriptOutline.ts` | F29 |
| K53, C23 | cURL previews parsed inputs leniently and rebuilt the endpoint in a domain module | Fixed: `tryParseExecutionInputs`, `ruleApi.executeUrl` | F26 |
| K63 | Double-clicking a Reuse card inserted two nodes | Fixed: `useLibraryInsertion` | F30 |
| E02, E04 | Providers re-registered every render; `@` search per keystroke with per-editor caches | Fixed: one search per typing pause instead of one per render (151 for one typed call) | F31 |
| C09 | Three placeholder tables and two snippet helpers with different contracts | Fixed: `placeholderLiterals.ts`, `escapeSnippetText`, `snippetStringLiteral` | F9 |
| C10 | `/api/functions` fetched by four components | Fixed: `useFunctionCatalog` | — |
| C12 | Hand-rolled playground paging with a duplicate history read | Fixed: `usePagedResource` | F5 |

### Frontend: data and transport

| ID | Finding | Status | Lesson |
| --- | --- | --- | --- |
| K54 | JSON default fields rewrote their text while typing | Fixed | F27 |
| K56 | Unreadable 2xx responses resolved `null` as success | Fixed: `ApiError` | F21 |
| A11 | No single lossless number policy at the HTTP boundary | Fixed with K32 | B6 |

### Frontend: application shell, navigation, library and sources

| ID | Finding | Status | Lesson |
| --- | --- | --- | --- |
| K39, K52, K61 | Source fields accepted what the server rejects (ID slug, timeout, parameter types) | Fixed: `ResourceIdField`, raw timeout buffer | F34 |
| K42 | Name edits replaced a typed Rule ID | Fixed | F32 |
| K43 | The sidebar Code studio target followed the library filter | Fixed: `useCodeStudioTarget` | F33 |
| K50 | Ligatures stayed on in canvas previews and JSON fields | Fixed: one shared rule in `base.css` | F11 |
| K62 | Cancelling a leave prompt rewrote browser history | Fixed: `history.go(delta)` | F24 |
| E01, E07 | Undebounced library search; every save refetched the hidden library | Fixed: 250 ms debounce, kept cards, preview cache, stale marking | F14 |
| E06 | React Flow was on the critical path of every route | Fixed: lazy editor route, React in its own chunk | — |
| C14 | Nested ternary chains for routing and per-kind presentation | Fixed: `WorkspaceRoute`, Record tables, node-kind descriptor | — |
| C15 | Source editor state outside the reducer; the client repeated the server's search | Fixed: `viewedConfiguration`, `canRunSourceTest`, `sourceCatalog.ts` | F2 |

### Web server

| ID | Finding | Status |
| --- | --- | --- |
| K24 | The 30 s proxy timeout equalled the execution deadline, so nginx's HTML `504` replaced the API's JSON `504` | Fixed: 40 s |
| SW2 | nginx resolved the api container once at startup (plausible) | Fixed: per-request resolution |
| SW4 | `index.html` had no cache policy and missing assets fell back to `index.html` (plausible) | Fixed: `no-cache`, immutable assets, `404` |
| SW5 | No gzip | Fixed |

## Structural refactors

These refactors preserve behavior apart from the few differences named below. Characterization tests, snapshots or computed-style recordings made before each refactor passed before and after it, and the new browser specs also pass on the pre-refactor build.

### Backend: node kinds, immutable model and narrow ports (C16, C18, A04, A07, C17, E17)

- **Node kinds.** `dev.arc.model.NodeKind` parses the unchanged JSON `type` and states each kind's facts (`storesResult`, ordered `handles`, `choosesOneExit`, expression `slots`) as exhaustive switches; `Handles` names every handle. Execution, validation and the Script renderer switch over kinds with exhaustive switch expressions and no `default`, so a new kind fails to compile until each owner handles it. String comparisons and hand-built handles are gone from a dozen backend classes, and the architecture script now rejects them outside `dev.arc.model`. `Definition.inputNode()` replaced the hand-written Input lookups, which disagreed about a missing Input (one failed with `500`).
- **Immutable model.** `Definition.Node` has one canonical constructor; `Definition.detached()` and `SourceDefinition.detached()` sit beside their records, and the plan cache weighs a plan from its compiled form and JSON instead of a hand-written field walk. `ExecutionResponse` wraps `Engine.Result` with `@JsonUnwrapped`, byte-identical on the wire. Tests build nodes through `support/GraphFixtures`.
- **Narrow ports.** `SourceAdapter` has one deadline-aware `fetch` and `SourceReader` one deadline-aware `read`; only request sessions implement `SourceReader`. A cached published plan runs without reading its version again.
- **Evidence.** [Payload snapshots](../../backend/src/test/java/dev/arc/api/PayloadSnapshotTest.java) of the preview/execute and graph JSON, [canonical script of every kind](../../backend/src/test/java/dev/arc/engine/script/ArcScriptContractTest.java) and every existing test passed before and after. The only observable changes are the ordered Condition missing-branch message and the skipped version read.
- **Not done, deliberately.** Rejecting fields that a kind does not own (for example `bindings` on a Formula) would make already-published versions fail; that needs a product decision. The current tolerance is pinned by [a test](../../backend/src/test/java/dev/arc/engine/validation/NodeContractsTest.java).

### Frontend: node-kind descriptor and command gate (A15, C14, C11, A16, A14)

- **Descriptor.** `domain/nodeKinds.ts` is one `Record<NodeType, NodeKind>` stating every per-kind fact: labels, new-node fields, style class key, result, palette, deletion and incoming-connection facts, exits, minimap fill and card summary. Graph mutations, ports, layout, cards, toolbar, inspector, previews, outline, symbol roles and Monarch type names read it; icons and inspector forms stay in exhaustive `Record<NodeType, …>` tables beside the UI. New-node JSON is pinned [byte for byte](../../frontend/tests/unit/node-kinds.spec.ts).
- **Command gate.** `useRuleDocument` exposes `capabilities` derived by the pure `editorCapabilities`, and gated `edit`, `editMetadata` and `editSource` operations that report whether the document accepted the change. More than 30 scattered `readOnly || busy` checks read capabilities instead, and raw `dispatch` is private. [The capability matrix](../../frontend/tests/unit/editor-capabilities.spec.ts) equals the old per-control conditions for every combination.
- **Other cleanup.** Every remaining nested JSX ternary and several casts are gone; the Test panel and playground share `useInputBuffer`.
- **Not done, deliberately.** `RuleNode` stays one interface instead of a discriminated union: schema-1 JSON does not enforce field ownership, so per-kind types would keep the same null checks, and generic patches and staged form merges would need correlated per-kind types across about 25 files without removing a cast. No shared request-slot helper was introduced, because each async flow completes differently.

### CSS tokens and the cascade cleanup (C08, A17, A15 colors)

- `styles/tokens.css` holds the fonts, a 7–13px type scale, 23 color roles, one color per node kind and three layout widths. Hex color uses outside the tokens fell from 464 to 319.
- The four late override files (`editor-readability.css`, `contextual-editor-overrides.css`, `interaction-controls.css`, `shared-controls.css`) are deleted. Every winning override was folded into the rule that owns its selector. About 50 owner declarations overridden by identical later selectors, about 30 that never won against a more specific rule or inline style, 17 rules that matched nothing and one unused custom property were removed.
- MUI sizing moved into the theme, and `!important` fell from 37 to 28 declarations, each with a comment. `index.css` fixes only two orders: tokens and base first, responsive layers last; the feature stylesheets give identical computed styles in reversed order.
- **Evidence.** A computed-style comparison of the production build recorded 342 UI states (45 scenarios at up to seven widths, plus forced hover and focus states): 77,386 element snapshots and 37,323,342 compared values, with 0 unintended differences. The only differences are the intended library preview colors, 34,748 values, all on preview node elements. The always-on [cascade check](../../frontend/tests/style-cascade.spec.ts) found 68 declarations overridden by a later rule with the same selector before and none after; the [equivalence spec](../../frontend/tests/style-equivalence.spec.ts) stays available, opt-in, for future refactors.

## Intended behavior changes

Every intended change is listed for API consumers in [the API reference](../api.md#behavior-changes-in-this-revision) and for editors in [the studio guide](../studio.md#behavior-changes-in-this-revision). The only visual change is that library preview node colors now match the canvas node colors, through one CSS token per kind:

| Kind | Preview before | Preview after (canvas color) |
| --- | --- | --- |
| Input | `#6c8561` | `#829276` |
| Formula | `#7d88af` | `#8392b5` |
| Condition | `#b79945` | `#b69c59` |
| Switch | `#b79945` | `#b69c59` |
| Transform | `#5b9ba0` | `#538f91` |
| Reference | `#9c79af` | `#a08abb` |
| Output | `#3b8f70` | `#7b9e72` |

## Verification

Final checks on the integrated tree:

- Backend `mvn verify` with Java 21: 481 tests, 0 failures; Spotless clean.
- Frontend: format check clean, 163 unit tests passed, build passed, architecture check passed.
- Live API smoke on a disposable stack: 107 checks in `scripts/smoke.py` and 80 in `scripts/studio_smoke.py`.
- Full browser suite on a disposable stack: 402 passed, 0 failed, 46 opt-in style-equivalence checks skipped.
- Structural-refactor runs: the node-kind and command-gate refactor passed 400 of 400 browser tests on a fresh database; the CSS refactor passed 382 with the 46 opt-in style checks skipped.
- CSS computed-style equivalence: 342 UI states, about 37.3 million compared values, 0 unintended differences. The only visual change is the library preview node colors now matching the canvas.

Fix packages checked that their new regression tests fail on the pre-fix code; packages that changed HTTP or browser behavior also ran the smoke scripts or the browser suite on their own stacks. Two browser tests that were flaky at the baseline are fixed: `editor-command-lifecycle.spec.ts` removed its route before navigating (a request started while interception was being turned off could stay paused), and `formula-calls.spec.ts` waits for the scope read before accepting an `@` completion.

## Follow-ups left open

- **MiniMap colors.** The minimap still takes its fill from `nodeKinds[type].minimapColor`, the last copy of kind colors in JavaScript. Give `MiniMap` a `nodeClassName` and set `fill: var(--node-kind-<kind>)` in CSS.
- **`RuleNode` discriminated union.** Deliberately not done; see the structural refactors above.
- **Route-driven view switches.** The sidebar and browser history change the route before the editor sees it, so those graph/code switches are reconciled on arrival and cannot be refused up front. Refusing them would need a non-confirming kind of navigation guard.
- **Remaining duplicated backend literals:** the JSONPath `@.type == "REFERENCE"` in `JdbcRuleRepository`; the `FAIL`/`DEFAULT` source error policy in `InputValidation` and `Parameters`; the `"@" + id + ":" + version` pin text in `GraphExecution` (twice), `FormulaCallValidation` and `RuleResolver`; the scalar type subset in `SourceValidator`; and the four-argument convenience constructors on `Definition` and `Input`.
- **Stylesheet behavior preserved as found:**
  - The laptop and mobile `.editor-actions` button sizes never applied, because `responsive/studio-wide.css` (≤1350px) is imported later; they were deleted as dead code. If the smaller sizes were intended, move them into or after that file.
  - Card border states: selected Condition, Reference and Output cards keep their kind border, so the selection shows only as the outline. Visited Switch and Transform cards keep their kind border, while visited Condition, Reference and Output cards show the visited border.
  - `.studio-filebar small` names `font-family: Inter, sans-serif`, but the loaded family is "Inter Variable", so the file hint renders in the fallback sans-serif.
  - The color, border radius and shadow in the `.expression-variable-popover` rule never reach the pinned popover, because MUI Paper's equal-specificity rules load later; only the hover tooltip gets them.
  - `.inspector-section.inspector-accordion` keeps inert `flex-direction` and `gap` on a block box.
- **Source read timing.** `Parameters.Read.durationMicros` still includes the time spent resolving the input's dependencies, not only its own read.
- **Source-contract walk.** Each execution still re-reads child pins and recompiles `@` expressions for the static source-contract check, even when the cached plan already holds them (the second half of E17).
- **Node field ownership (A04).** Resolved after the review, once the product decision was made: a node that sets a property its kind does not use is rejected at that node when saving, publishing, previewing and executing. Stored drafts and published versions are not rewritten; one that holds such a property fails until the inspector's **Remove** clears it from the draft and the rule is published again (lesson B25).
