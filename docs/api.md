# HTTP API

Base URL: `http://localhost:8080/api` (also proxied by the workspace at `http://localhost:3080/api`). Send JSON with `Content-Type: application/json`. No JWT is required in this release. Responses write decimal numbers in plain notation, for example `20` and `0.0000001`, never exponent forms such as `2E+1`. See [the behavior changes from the 2026-10-01 final review](#behavior-changes-from-the-2026-10-01-final-review), [from the 2026-10-01 backend review](#behavior-changes-from-the-2026-10-01-backend-review), [from the second review](#behavior-changes-from-the-second-review) and [in this revision](#behavior-changes-in-this-revision) for results that differ from earlier releases.

## Execute

`POST /rules/{id}/execute`

```json
{"inputs":{"orderTotal":150,"customerTier":"premium"},"version":1}
```

`version` is optional: omit it to run the latest published version. Only published versions can be executed by rule ID. Editing a draft has no effect on this endpoint.

The response includes `ruleId`, `version`, `result`, `durationMicros`, and `trace`. A trace step contains `ruleId`, `version`, `nodeId`, `label`, `type`, `value`, `branch`, and `depth`. A condition's branch is `"true"` or `"false"`; a Switch's is `"case:<id>"` for the case it matched or `"default"`; ordinary progression is `"next"`; an Output has `null`. Nested rules have `depth > 0` and their own pinned versions.

Both execute and preview accept optional `trace` and `timeoutMs` fields:

```json
{"inputs":{"orderTotal":150,"customerTier":"premium"},"version":1,"trace":false,"timeoutMs":5000}
```

`trace` defaults to `true`. Its serialized JSON array is bounded to 256 KiB and retains a prefix of complete steps. Responses add `traceEnabled`, `traceTruncated`, `executedSteps`, and `traceBytes`. A truncated trace does not truncate the final result or weaken the shared 1,000-step execution limit. When disabled, the trace is empty and `traceTruncated` is false. The editor and API playground expose the switch, indicate truncation, and reflect the options in their cURL examples. Graph highlights cover only retained trace steps.

`timeoutMs` defaults to 30,000 and accepts integers from 100 through 30,000. One deadline is shared by preparation, nested rules, expression evaluation and source reads; HTTP reads, their host lookup included, are capped by both the source timeout and the remaining execution time. Deadline exhaustion returns `504` and cannot be converted into a source fallback. Execution checks are cooperative at processing boundaries; this is not an infrastructure timeout for database drivers, JVM pauses or response transmission.

Responses add `timing: {preparationMicros, executionMicros, totalMicros}`. Preparation includes root-version lookup and static checks; execution includes parameter reads and graph evaluation. Server timing ends before HTTP response serialization/transfer. Existing `durationMicros` retains engine timing. The UI separately measures the browser request round trip, including response download and JSON parsing; it is not sent as a server response field.

Expressions can call a published Formula with `@rule-id:version(arguments)`. Arguments follow the pinned input order, and omitted trailing inputs use the callee's normal default/source rules. The callee must be a published `FORMULA`; the positive version is mandatory. Calls share the execution deadline, step/read/depth limits and trace with their parent. `$IFERROR` and the `$IS…` error functions handle value errors only: an exhausted shared limit fails the request with `422`, the deadline with `504`, and a called version that cannot be prepared (a missing or non-Formula pin, or a stored definition that no longer passes draft shape or compilation) with the callee's own error and location. See [Formula calls in the editor](studio.md) for completion, hover and null/omission behavior.

Each source handle may have multiple downstream connections. Active nodes execute once after their predecessors are resolved. A single reached Output returns its value, wrapped as `{outputName: value}` when its optional Output name is set. Multiple reached Outputs return one object of raw values keyed by nonempty `outputName`, otherwise a trimmed bare variable name, otherwise node ID; for example `"result":{"amount":100,"discounted":72}`. Constants, property paths and compound expressions need an explicit Output name to avoid the node-ID fallback. A named Output adds no extra wrapper within this aggregate. Duplicate keys among reached Outputs return `422` with both node locations, even for null values. Conditional branches that are skipped do not produce keys or collisions. This naming policy applies to existing published versions too; their stored definitions and pins are unchanged. Shared joins combine upstream values before calculating their expression.

## Create and edit

`POST /rules` returns `201` and a complete rule resource:

```json
{
  "id": "tax-calculator",
  "name": "Tax calculator",
  "description": "Calculate an order total including tax.",
  "kind": "FORMULA"
}
```

Kinds: `DECISION_TREE`, `FORMULA`, `RULE`. Omit `definition` to start from a valid template, or provide a complete graph document as `definition`. IDs must match `[a-z][a-z0-9-]{0,79}` and remain permanent.

`GET /rules` lists full rule resources. `GET /rules/{id}` returns one. Each includes `draft`, integer `revision`, nullable `publishedVersion`, `createdAt`, and `updatedAt`.

For catalogs, use `GET /rule-summaries?offset=0&limit=20&search=tax&kind=FORMULA&publishedOnly=false`. It returns `{items,total,offset,limit}`. Each item contains rule metadata plus `nodeCount`, `inputCount`, `referenceCount` and `draftChanged` (the saved draft differs from the latest published version), without `draft`. Search matches rule ID/name/description; surrounding whitespace is ignored, so a whitespace-only search returns the unfiltered page. `kind` and `publishedOnly` are optional filters. `offset` must be nonnegative (default 0) and `limit` between 1 and 100 (default 20). Every search is trimmed first and may then have at most 200 characters. Pages use a deterministic order; separate page requests do not form a frozen snapshot during concurrent edits. `GET /rule-summaries/{id}` returns one rule's item, with the same fields and without `draft`, or `404` for a missing rule; the editor reads it for the current name and incarnation of a rule another rule calls.

Version pickers should use `GET /rules/{id}/version-summaries?offset=0&limit=20`, whose items contain `ruleId`, `version`, `publishedAt` and the version's `note` (null for none), newest first. Optional `search` (at most 200 characters) matches a trimmed literal substring of the version number: `search=2` matches versions 2, 12 and 20. An empty search returns all versions; `total` counts only matching versions, and pagination applies after filtering. Fetch the selected definition with `GET /rules/{id}/versions/{version}`. The legacy full `/rules` and `/rules/{id}/versions` endpoints remain compatible but are unbounded; workspace callers use the paginated summaries and on-demand details.

Data sources use the same page envelope and bounds: `GET /source-summaries?offset=0&limit=20&search=tax` returns `{id,name,version,kind}` items; `GET /sources/{id}/version-summaries` returns `{id,version,createdAt}` items. Load a selected configuration through `GET /sources/{id}/versions/{version}`. Legacy full source lists/history remain available for existing clients; `GET /sources/{id}/versions` returns `404` for an unknown source, like the other version reads.

`PUT /rules/{id}` saves a draft:

```json
{
  "name": "Tax calculator",
  "description": "Calculate an order total including tax.",
  "revision": 1,
  "definition": {
    "schemaVersion": 1,
    "inputs": [{"name":"amount","type":"NUMBER","required":true,"defaultValue":null}],
    "nodes": [
      {"id":"input","type":"INPUT","label":"Inputs","position":{"x":280,"y":0}},
      {"id":"result","type":"OUTPUT","label":"Total with tax","position":{"x":280,"y":160},"expression":"$round(amount * 1.08, 2)"}
    ],
    "edges": [{"id":"input-result","source":"input","target":"result","sourceHandle":"next"}]
  }
}
```

Supply the most recently read `revision`. A successful save advances it. A stale revision returns `409`; fetch the current rule and reconcile before retrying. A save or publication without a revision (or with `"revision": null`) returns `422` "Revision is required". Drafts may be incomplete, but a node's `version` needs a `ruleId` and must be at least 1; other values return `422`.

## Validate and preview

`POST /validate` accepts the graph document directly, and returns `{"valid":true}` for a complete graph. Invalid graphs return `422`; missing published dependencies return `404`. Expression problems name their position, for example `rate source / region: uses missing, which is not an input of this rule; a source mapping reads only inputs`. A node expression that reads a name tells whether anything declares it: `Check: uses amount, which no input or result variable provides; correct the name or add an input named amount` when no input or result variable has the name, and `Total: uses discount, which is not set on every path into this step; set it on each path that leads here` when some step sets it but not every path into the node.

`POST /preview` accepts `{"definition": {...}, "inputs": {...}}`. It runs an unsaved graph and returns the same execution structure, with `ruleId: "preview"` and `version: null`. A published rule may also use the ID `preview`, but its locations always carry a version, so recognize the preview root by `ruleId: "preview"` together with `version: null`. Referenced rules must still be published and explicitly versioned.

`POST /variables` accepts a graph document and returns node IDs mapped to arrays of variable names guaranteed to be available at that node. It accepts incomplete acyclic drafts; it does not execute expressions, fetch sources or resolve referenced rules. The editor uses it for parameter mapping choices. Invalid structure or cycles return `422`; a cycle error lists the nodes of one cycle in `locations`. Only the structure a scope plan reads is checked (node IDs and kinds, Switch cases, connections and input names): a blank label, an oversized expression, a property a node kind does not use or an invalid default elsewhere in the draft does not fail the read.

## Publish and inspect versions

`POST /rules/{id}/publish` accepts `{"revision":2}` and an optional `"note"` of at most 500 characters saying what the version changes (blank is none; a longer note is `422` "Release note exceeds 500 characters"). It validates the current saved draft, creates a new immutable version with the note, advances the edit revision, and returns the updated rule. Publishing invalid drafts never changes the live version. The server publishes a draft identical to the latest version as a new version; the editor's publish dialog shows the changes since that version and refuses an unchanged draft.

- `GET /rules/{id}/versions`: version objects, newest first.
- `GET /rules/{id}/versions/{version}`: one immutable snapshot.
- Version objects contain `ruleId`, `version`, `definition`, and `publishedAt`.

The UI saves any changed draft before publishing. API clients should save explicitly, then publish using the returned revision.

## Delete a rule

`DELETE /rules/{id}` removes the rule with its draft and every published version and returns `204` without a body. Afterwards every request for the rule returns `404`, including execution of a pinned version, and the ID can name a new rule. Data sources cannot be deleted.

Pass the `revision` you read (`DELETE /rules/{id}?revision=4`) to delete only the rule you looked at: a rule saved, published or re-created since then answers `409` "This rule changed in another editor. Reload it before saving, publishing or deleting.", as a stale save does. Without the parameter the current rule is deleted.

A rule that another rule still calls is kept. That covers a Reference node that has chosen the rule, with or without a version, and an `@id:version` call in any node or input source mapping of any draft or published version, including unfinished drafts without an Input node. The request returns `409` "Other rules call this rule: checkout (draft), checkout v3. Remove those calls before deleting it." The message names up to five callers; `issues` lists them all. Delete or change the callers first. A caller saved or published while the deletion runs is either seen by it or refused: writes hold the rules they call until they commit.

Revisions come from one sequence for all rules, so they advance but are not consecutive, and a rule created again under a deleted ID never repeats a revision an editor may still hold: that editor's next save, publish or delete answers `409`.

## Find the rules that call a rule

`GET /rules/{id}/callers?offset=0&limit=20` lists the other rules whose saved draft or published versions call this rule, through a Reference node or an `@id:version` call in any node or input source mapping: the rules a deletion would name, each once, ordered by rule ID. It returns the catalogs' `{items,total,offset,limit}` envelope with the same bounds (`offset` at least 0, `limit` from 1 to 100, default 20; `422` "Use offset >= 0 and limit from 1 to 100" otherwise), and `404` "Rule not found: id" for an unknown rule.

```json
{
  "items": [
    {"ruleId": "order-pricing", "name": "Order pricing", "draftPins": [1, 2], "published": {"version": 3, "pins": [1]}, "earlierVersions": 2}
  ],
  "total": 1, "offset": 0, "limit": 20
}
```

- `draftPins`: the versions of this rule that the caller's saved draft pins, ascending; `null` when the draft does not call the rule, and `[]` while a Reference has chosen it without a version.
- `published`: the caller's latest published version and the versions of this rule it pins, when that version calls the rule; `null` when the caller is unpublished or its latest version does not call it.
- `earlierVersions`: how many of the caller's older published versions call the rule. They still run when a client names them, and they keep the rule from deletion.

Pins are read from each caller's draft and latest version one at a time, so a caller changed between the page and those reads shows what the later read found: a draft saved without the call has no pins. The count and the page are separate statements, as in the catalogs.

## Duplicate a rule

`POST /rules/{id}/duplicate` creates a new rule from this one and returns it with `201`, as `POST /rules` does:

```json
{"id": "order-pricing-eu", "name": "Order pricing (EU)", "description": "Prices EU orders", "version": 3, "includeTests": true}
```

The new rule has the original's kind and, as its draft, the original's saved draft, or published `version` when one is given. Nothing is published. An omitted or null `description` copies the original's; any string, `""` included, is used as given. The original's saved test cases are copied, names, inputs and expectations as stored, unless `includeTests` is `false`. The rule and its copied cases are created together or not at all, and the original stays editable, but not deletable, while the copy runs.

The body is read strictly: an unknown field is a `400` that names it. An unknown original is `404` "Rule not found: id" before the body's values are checked; `id`, `name` and `description` are then refused exactly as `POST /rules` refuses them (`422`), a taken `id` is `409` "This rule ID already exists", and a version the original lacks is `404` "Published rule version not found: id vN".

## Decision tables

A `DECISION_TABLE` node holds a `table` and stores its value in `output`, like a Formula:

```json
{"id": "fee", "type": "DECISION_TABLE", "label": "Shipping fee", "output": "shipping",
 "table": {"hitPolicy": "FIRST",
           "conditions": [{"label": "Tier", "expression": "tier"}, {"label": "Order amount", "expression": "amount"}],
           "results": [{"name": "fee"}],
           "rows": [{"when": ["\"gold\"", "-"], "then": ["0"]},
                    {"when": ["-", ">= 100"], "then": ["0"]},
                    {"when": ["-", "< 100"], "then": ["8"]}]}}
```

Each condition's expression is evaluated once; a row matches when every test in `when` holds for its column's value, and its `then` expressions give the value: one result column's value, or an object keyed by result name for several. `hitPolicy` `FIRST` (the default when absent or null) takes the first matching row, `UNIQUE` the only one and `COLLECT` every matching row as a list. A test is `-`, a value (`"gold"`, `100`, `true`, `null`), `!= value`, `<`, `<=`, `>` or `>=` a number, a number range (`10..20`, `10..<20`, `10<..20`, `10<..<20`), a comma-separated list of those, or `not(list)`; text is tested by equality only. [The graph contract](architecture.md#graph-document) has the full rules.

- Draft saves check the table's shape (`422` at the node): `table` is required on this kind and refused on every other ("Tables belong to Decision table nodes"); `conditions`, `results` and `rows` are required lists; at most 20 conditions, 10 results and 200 rows; condition labels are unique and 1–160 characters; result names are unique identifiers (empty while unfinished); every row has one test per condition and one result per result column ("Row 3 has 2 tests, but the table has 3 conditions"); a cell is text of at most 2,000 characters; `hitPolicy` is `FIRST`, `UNIQUE`, `COLLECT` or null.
- `/validate`, `/diagnostics`, preview and publish also require a condition, a result and a row, a name for every result, a test in every condition cell and one type of value per condition column, naming the cell: `Shipping fee / Row 3 / Condition Tier: Write text in quotes: "gold"; a test cannot read a variable`.
- Execution fails with `422` at the node when `FIRST` or `UNIQUE` finds no row ("No row matches Tier "silver", Order amount null"), when `UNIQUE` finds several ("Rows 1 and 3 both match …; with one match only, rows must not overlap"), when a condition's value is an array or an object, and when a comparison or range meets text or a boolean.
- A trace step of the node has `"branch": "next"` and `matchedRows`, the rows that produced its value numbered from 1 (`[3]`; `COLLECT` lists every match, perhaps none). No other step has `matchedRows`, and no other node has a `table` field: their JSON is unchanged.

## Saved test cases

A rule keeps up to 100 test cases: inputs to run and the outcome they should produce. They belong to the rule, not to its draft or its published versions, so writing one changes neither the draft nor its `revision` or `updatedAt`, and deleting the rule deletes its cases. The server stores cases; running and comparing them is the client's work. The editor runs each case through `POST /preview` against the graph it shows; an API client can run them through `POST /rules/{id}/execute` against a published version.

- `GET /rules/{id}/test-cases`: the rule's cases, oldest first.
- `POST /rules/{id}/test-cases`: adds a case and returns it with `201`.
- `PUT /rules/{id}/test-cases/{caseId}`: replaces a case's name, inputs and expected outcome.
- `DELETE /rules/{id}/test-cases/{caseId}`: deletes a case and returns `204` without a body.

```json
{"name": "Premium order", "inputs": {"orderTotal": 150, "customerTier": "premium"}, "expectedResult": 120.00}
```

A stored case adds `id`, `ruleId`, `createdAt` and `updatedAt`, and always carries both `expectedResult` and `expectedError`. Inputs are kept as written, including an explicit `null` beside an omitted input, and numbers keep their decimal places (`120.00` stays `120.00`).

- **Expected outcome:** without `expectedError` the run passes when its result equals `expectedResult`; an omitted or null `expectedResult` expects a null result. With `expectedError` (1–2,000 characters) it passes when the run fails with a message containing that text, and `expectedResult` must be null or omitted. The editor compares results by value, so `120` equals `120.00`, objects by their fields and arrays in order.
- **Requests** are read strictly: an unknown field is a `400` that names it, and a `caseId` that is not a whole number is a `400` too.
- **Not found:** an unknown rule is `404` "Rule not found: pricing" and an unknown case, or a case of another rule, `404` "Test case not found: 12". The rule and the case are found before the body is checked.
- **Invalid content** is a `422`:

| Message | When |
| --- | --- |
| Test case name must contain 1 to 160 characters | The name is missing, blank or longer once trimmed |
| Test case name cannot contain control characters | The name has a control character |
| Test case inputs must be a JSON object; send {} for none | `inputs` is missing, null or not an object |
| A test case expects a result or an error, not both | `expectedError` is set together with a non-null `expectedResult` |
| Expected error must contain text; send null to expect a result instead | `expectedError` is blank |
| Expected error exceeds 2,000 characters | `expectedError` is longer |
| Test case inputs and expected result exceed 64 KiB | The two take more than 64 KiB of JSON together |
| A rule keeps at most 100 test cases; delete one before adding another | The rule already has 100 cases; creations are counted under the rule's lock, so concurrent ones never pass the limit |
| Text cannot contain the NUL character (U+0000), or an unpaired UTF-16 surrogate | Text that storage cannot hold, as for every stored text |

## Errors

```json
{"status":422,"message":"Missing required input: orderTotal","issues":["Missing required input: orderTotal"],"locations":[{"ruleId":"preview","version":null,"nodeId":"input","label":"Inputs"}]}
```

`locations` identifies affected graph nodes, deepest failure first, followed by reference callers. Validation may use a null rule ID for the submitted graph. A connection problem is located at the node the connection leaves, or at the node it enters when the source is missing; problems of the whole graph or its inputs are located at the Input node. Errors outside a graph may omit locations or return an empty array.

| HTTP status | Meaning |
| --- | --- |
| `400` | Malformed JSON, a second document after the body, a fraction where an integer belongs (`"version": 1.9`) or another invalid request value ("Request contains malformed JSON or an invalid value"); an unknown field, named by its path ("Request contains an unknown field: definition.inputs[0].source.pointr") |
| `404` | Missing rule, source, version or test case |
| `405` | Method not supported by the path; the `Allow` header lists the supported ones |
| `409` | Duplicate rule or source ID (`This rule ID already exists`, `This source ID already exists`), stale revision, execution of an unpublished rule, or deletion of a rule that other rules call |
| `413` | Request body larger than 1 MiB, for any method or path |
| `415` | Body media type the endpoint does not read, multipart included; the `Accept` header lists the supported ones |
| `422` | Invalid graph, expression, input, or calculation; exhausted execution limit (steps, nesting, source reads, expression operations, a multi-Output result past its budget); text containing the NUL character (U+0000) or an unpaired UTF-16 surrogate, which storage cannot hold as written |
| `500` | Unexpected internal error (details are logged, not exposed) |
| `504` | Execution deadline exhausted, including across nested rules and source reads |

The current release has no batch endpoint, run-history storage, or authentication, and data sources cannot be deleted. Rules and published versions persist until the rule is deleted; execution traces are returned to the caller rather than stored.

## Code studio and external parameters

See [the studio guide](studio.md) for ARC Script, the function catalog, source APIs, and HTTP configuration. Inputs additionally accept ARRAY and OBJECT types and optional versioned `source` bindings. Execution responses include a `sources` array describing fetches and defaults. Entries appear in read order: an input's source dependencies are read first, in declaration order.

## Behavior changes from the decision table node

A node type is new; graphs without it keep their JSON, results and messages, except one message, and no migration runs.

- `DECISION_TABLE` nodes choose a value by rows ([Decision tables](#decision-tables)). Node JSON gains `table` on those nodes only, and trace steps gain `matchedRows` on their steps only.
- A result variable on a kind that does not store one is now refused with "Result variables belong to Formula, Transform, Reference and Decision table nodes" (it listed Formula, Transform and Reference).

## Behavior changes from the 2026-10-18 round-3 usability work

Two endpoints are new; existing endpoints, payloads and messages are unchanged, and no migration runs.

- `GET /rules/{id}/callers` pages the other rules that call a rule, with the versions their drafts and latest versions pin ([Find the rules that call a rule](#find-the-rules-that-call-a-rule)). It reads the callee sets that rule deletion already reads.
- `POST /rules/{id}/duplicate` creates a rule from another's saved draft or published version, with its saved test cases ([Duplicate a rule](#duplicate-a-rule)).

## Behavior changes from the 2026-10-18 usability work

Graph JSON, ARC Script, stored versions and pins are unchanged. Saved test cases are new, and the messages below say what to do.

- `GET`/`POST /rules/{id}/test-cases` and `PUT`/`DELETE /rules/{id}/test-cases/{caseId}` store a rule's test cases ([Saved test cases](#saved-test-cases)) in a table that migration V7 adds; deleting a rule deletes its cases.
- A node expression that reads a name outside its scope said "Variables unavailable on every incoming path: amount" whatever the cause. It now tells a name that no input or result variable declares, typically left behind by a rename ("Check: uses amount, which no input or result variable provides; correct the name or add an input named amount"), from one that some step sets but not every path into the node ("Total: uses discount, which is not set on every path into this step; set it on each path that leads here"). Several names are listed as "amount and rate" with plural wording, and an expression with both kinds reports both sentences. A single undeclared name that differs from a declared input or result variable only in case, or by one edit (an inserted, deleted, replaced or swapped character; two edits for names of six or more characters), asks instead: "Check: uses amont, which no input or result variable provides; did you mean amount?". The closest name is offered, the earlier declaration on a tie.
- A source mapping that reads a name other than an input said the same; it now reports "rate source / region: uses missing, which is not an input of this rule; a source mapping reads only inputs", or "rate source / key: uses contry, which is not an input of this rule; did you mean country?" when one name closely misspells an input.
- A sourced input without a mapping for a required source parameter reported "amount: missing source mapping for key"; it now reports "amount: choose what to pass as key to data source country-tax v1". A mapping for a parameter the source does not have reported "Unknown source parameter: wrong" without the input; it now reports "amount: data source country-tax v1 has no parameter named wrong; remove what this input passes as wrong". `POST /sources/{id}/test` keeps "Unknown source parameter: wrong" for an argument the source does not declare.
- A Reference that leaves a required input of its rule unset reported "Reuse: missing binding for amount"; it now reports "Reuse: choose what to pass as amount to apply-discount v1". A binding for an input the pinned version does not have reported "Reuse: unknown parameter ghost"; it now reports "Reuse: apply-discount v1 has no input named ghost; remove what this step passes as ghost".
- A result variable named like an input reported "Calc: cannot overwrite input amount"; it now reports "Calc: its result variable amount has the name of an input; choose another name".

## Behavior changes from the 2026-10-17 usability work

Graph JSON, ARC Script, stored versions and pins are unchanged. Two optional fields are new, and validation messages read as sentences.

- `POST /rules/{id}/publish` accepts an optional `note` (at most 500 characters), stored with the version by migration V6; `GET /rules/{id}/version-summaries` returns it as `note`, null for none and for versions published earlier.
- `GET /rule-summaries` and `GET /rule-summaries/{id}` return `draftChanged`: the saved draft differs from the latest published version (always false before the first). The library marks such rules "Unpublished changes".
- A missing connection names only the exits still missing, by their captions: "Check: connect the False exit", "Route: connect the Gold and Default exits", "Calc: connect it to a next step". It listed every handle ID ("Check: connect [true, false]"), connected or not. An Output with outgoing connections reports "Out: remove its outgoing connections, since an Output ends the path" (was "Out: connect no outgoing branches"), and an unreachable node "Lost: not reachable from Input; connect it or remove it" (was "Every node must be reachable from Input; connect or remove unused nodes", without its label).
- A new Decision tree starts from a branch (an amount of at least 100 gets 10% off, otherwise the full amount) instead of the Formula's single calculation. Formula and Condition rule templates are unchanged.

## Behavior changes from the 2026-10-11 full review

These changes shipped with [the 2026-10-11 full review](reviews/2026-10-11-full-review.md). Graph JSON, stored versions and pins are unchanged. Results listed here changed because the earlier behavior was a defect or because a limit was missing; one validation rule now refuses a graph shape whose every execution failed.

**Requests and storage**

- A rule input or source parameter without `required`, or with `"required": null`, is refused with `422` "Declare whether input amount is required (true or false)" or "Declare whether source parameter key is required (true or false)". It was stored as optional, so a Reference node or Formula call no longer had to bind it and an execution ran with `null` instead of the documented "Missing required input". An HTTP source without `timeoutMs` is refused with the existing "HTTP timeout must be 100–10,000 ms" (it was stored as 0 and refused with the same text, so only an omitted or null value is new); a LOOKUP source created without one stores and returns `timeoutMs: null` (it was 0).
- Deleting a rule reads the rules each draft and version calls from the sets stored beside them (the `callees` columns of migration V5) instead of scanning and serializing every stored definition inside the deletion's transaction (14.5 s at 2 GB of stored JSON, while every caller's save waited). Every create, save and publish stores the set it holds against deletion, so the two cannot disagree. Rows written before the migration carry a backfilled superset until their next save or publish: a rule that such a draft names only inside an expression's string literal is reported as a caller until that draft is saved again; versions keep their set.
- `POST /rules/{id}/publish` copies the stored draft into the version in SQL and returns the draft as read under the lock. A draft stored by an older record shape is copied as stored instead of being normalized through the current records; both are read leniently.
- `/validate` and `/diagnostics` keep the compiled plans of the committed pinned versions they reach, so a draft that calls published rules is no longer recompiled with them on every editor check; publishing and the sample seed, which run inside a transaction, still store nothing. A draft preview resolves its pins through the same plan cache instead of reading and decoding each pinned version per request.
- Catalog searches match with a plain `strpos` per field instead of a per-row subquery; results are unchanged.
- A client that closes its connection while a response is streaming no longer produces an ERROR log entry with a stack trace and a second `500` write; nothing changes on the wire.
- A rule or source name made only of no-break spaces (U+00A0, U+2007, U+202F), alone or with other spaces, is refused with `422` "Rule name must contain 1 to 160 characters" or "Source name must contain 1 to 160 characters", as names of other Unicode spaces already were.
- The specification lists exactly the served operations (a documented path that is no longer served fails the contract test too), its node-type, rule-kind and source-kind enums are checked against the server's vocabularies, and `trace`/`timeoutMs` are one `ExecutionOptions` schema composed into the execute and preview bodies. Nothing changes on the wire.

**Calculations and limits**

- A multi-Output result is bounded as a whole: more than 100,000 elements or 2,000,000 characters of text across the reached Outputs fails with `422` "Result exceeds 100,000 elements across its Outputs" or "Result exceeds 2,000,000 characters of text across its Outputs", located at the Output that passes the budget and, in a parent, at the calling Reference or Formula node; `$IFERROR` and the other fallbacks do not catch it, and a Reference and a direct `@id:version` call meet the same limit. Nothing bounded the aggregate before: within the per-value limits one request could stream gigabytes, and a parent holding such values from nine References exhausted the heap.
- A zero computed by an operator or a function keeps at most 34 decimal places, the precision of every other result, instead of 100: `amount * (rate / 12)` with `amount` 0 answers `0.0000000000000000000000000000000000` (34 places) instead of 36, and a chain of multiplications no longer grows to a 102-character zero. Zeros within 34 places are unchanged, so `$TO_STRING(0 * 1.50)` is still `0.00`.
- `$GET` and `$PLUCK` refuse a boolean path with `422` "GET needs a text or number path" ("PLUCK needs a text or number path"); a flag passed by mistake read a field named `true` or `false`, or answered the fallback, without a diagnosis.
- Operators no longer check their operands' bounds again: every number is bounded where it enters (inputs, defaults, literals, source values and every result), and a 1,000-item `$SUM($MAP(…))` spent a third of its time on those repeated checks. Results are unchanged.
- An HTTP source whose host name does not resolve within the source timeout or the execution deadline fails there (`422` "HTTP source failed…" or `504`) instead of holding the request, and the evaluation thread, until the operating system's resolver gives up.
- An HTTP source response is bounded while it is parsed, with the same four messages, instead of being parsed in full (up to 350,000 objects and 23 MB for 1 MiB of JSON) before the check. Where a document exceeds several bounds, the first met while streaming is reported.

**Validation, diagnostics and expressions**

- Validation, `/diagnostics` and publishing refuse a graph in which two writers of one result variable both run on every path to a join and neither reads the other's value: `422` "Conflicting upstream values for 'price': List price and Member price both set it on every path to Return; use distinct result variable names before merging", located at the join and at each writer. Every execution of such a version failed with "Conflicting upstream values" before. A stored version of that shape now fails at compile with this message, and a parent that pins it fails validation, diagnostics and publishing at its Reference node, as for any pinned version that no longer compiles; its executions behave as before. Writers linked only through a branch that may be skipped depend on the inputs and remain a runtime check.
- `/diagnostics` lists the problems of the whole graph (source mappings, input cycles, connections, a cycle, reachability) before node problems, and node problems in execution order; the first entry is the problem `/validate` and a publish name, which could differ before.
- `POST /variables` no longer fails for a draft whose input name is not an identifier; a missing or duplicate name still fails, and the draft's diagnostics still report the name.
- An expression missing a closing bracket or separator at its end reports "Incomplete expression: expected ')'" (or `']'`, `','`) instead of "Expected ')', got '<end>'". The hint "Function calls require a $ prefix; use $NAME(...)" is given only for a name the catalog can run; another name reports "NAME is not a function (see function catalog)", and a dotted name "Property paths cannot be called: customer.name".
- An empty or blank connection ID is refused with `422` "Every connection needs a unique ID"; it was accepted, rendered as `edge "";`, and its selection hid the Delete connection button in the editor.
- A JSON pointer longer than 500 characters is refused with `422` "JSON pointer exceeds 500 characters" instead of "Use a JSON pointer starting with /".

**ARC Script**

- A declaration's value may follow its keyword without a space: `when(amount > 1);`, `return[1, 2];`, `return"x";`, `return-1;`, `select(tier);` and `let=(amount + 1);` build like their spaced forms; canonical code keeps the space.
- `edge "";` is reported at its statement as "Every connection needs a unique ID".

## Behavior changes from the 2026-10-01 final review

These changes shipped with [the 2026-10-01 final review](reviews/2026-10-01-final-review.md). Graph JSON, stored versions and pins are unchanged, and every published version that compiled before the backend review compiles again. Results listed here changed because the earlier behavior was a defect.

**Requests and storage**

- `GET /rule-summaries/{id}` is new: one rule's catalog item without its draft. The editor reads it for a Reference node's rule and a Formula call's hover, which downloaded the whole rule for its name.
- Request bodies are read strictly. An unknown field returns `400` "Request contains an unknown field: definition.inputs[0].source.pointr", naming its path; it used to be dropped, so a source binding with a misspelled `pointer` read the whole response, and a misspelled `version`, `outputName` or `secretHeaders` vanished without an error. A second JSON document after the body and a fraction where an integer belongs (`"version": 1.9`, `"revision": 5.99`) return `400` "Request contains malformed JSON or an invalid value" instead of being ignored or truncated. Stored rules, versions and sources are read as before.
- A draft or source save returns `422` "Definition exceeds 960 KiB once its numbers are written out in full, more than a save can send back" when its JSON, written as responses write it, would not fit in the next save. Stored numbers are written out in full (`1e100` has 101 digits), so a 140 KB save could store 2 MB, and every later save from the editor was a `413`. Publishing a saved draft is not refused.
- Catalog searches ignore every kind of surrounding whitespace, including the ideographic space (U+3000) an input method types.
- Validate, diagnostics and publish no longer run under the execution deadline, so a slow check no longer answers `504`. After a startup whose sample seeding was rolled back, a version the seed never committed returns `404`; the API ran a plan cached from it, also for a version 1 the user published later.

**Calculations**

- `$SWITCH` without a matching case or a default is #N/A, as in Excel: `$ISNA` answers `TRUE` and `$ISERR` `FALSE` (they answered `FALSE` and `TRUE`). The failure message and `$IFERROR` are unchanged.
- `$ERROR.TYPE` is executable again, so published versions that mention it compile and return the values they returned before the backend review.
- Every function argument that reads a number from date text refuses text without a year, not only the date functions: `$INT("15 Jan")`, `$MOD`, `$TRUNC`, `$FIXED` and the financial and matrix functions (36 more) took the year the server started.
- `$CODE("A")` is the number `65`, not the text `"65"`. `$ROMAN(n)` and `$ROMAN(n, TRUE)` write the classic form, `$INDEX` accepts an area number, and `$IPMT` and `$PPMT` take a future value and a payment type, as in Excel; `$PPMT` used to ignore them (`-62.83` instead of `-107.45`). `$COUNTA()` without an argument returns `422`, as Excel refuses it. Catalog signatures of functions without required arguments read `NAME(...)` instead of `NAME(, ...)`.
- `$TEXT` refuses format codes longer than Excel's 255 characters with `422`. Longer codes answered `#VALUE!` or a formatted value, depending on how warm the server was.
- Number bounds judge a number's value, whatever its spelling: `10E+100` was accepted where `1E+101` was refused, and a default written that way was stored and then failed its next save. Both are refused now.
- A called rule checks the step budget before it reads its sourced inputs: a run already past 1,000 steps no longer fetches one source per callee before failing.
- The deepest evaluation the limits allow (17 nested rules, each inside expressions nested 48 levels deep) no longer fails its first request after a start with `500`.

**ARC Script and validation**

- `//` starts a comment anywhere outside quotes, inside a statement or a header too, and becomes a note, as between statements. Such code failed to build with "Invalid expression".
- Rendering a graph returns `422` at the node when an expression holds `;`, `}` or `//` outside quotes and brackets, or an unclosed quote or bracket: "<label>: ARC Script cannot show <part>, which has a ';', '}' or '//' outside quotes or an unclosed quote or bracket; correct it in the graph". Such an expression was written as it was, and building that code turned it into other statements (an injected Output name, connection or pin) or ran it into the next one.
- A build compiles every source mapping and reports a problem at the source statement ("rate source / key: <problem>"); an unparsable mapping built, and only the diagnostics reported it.
- An input named `source` is a declaration however it is spaced (`source : NUMBER required`); it was read as a malformed source binding.
- JSON literals and source bindings in ARC Script refuse unknown fields and fractional versions.
- A node fragment whose connection repeats the ID of a later connection in the graph is reported at the fragment's connection statement instead of 1:1.
- A connection from an exit its node does not have, such as `case:old` on a Condition, is reported as "<label>: remove the connection from case:old, which this node does not have". It was reported as a missing "connect [true, false]" although both were connected, and its target's declared inputs as unavailable. Branch analysis accepts again the "try the next tier" ladders that the backend review's test numbering made "too complex" in every drawing order: it tries three numberings and reports a graph too complex only when none fits.

**Data sources**

- HTTP source URLs accept the scheme in any case (`HTTPS://`), as RFC 3986 reads it; such a URL was refused.

## Behavior changes from the 2026-10-01 backend review

These changes shipped with [the 2026-10-01 backend review](reviews/2026-10-01-backend-review.md). Graph JSON, the ARC Script text of complete graphs, stored versions and pins are unchanged; results listed here changed because the earlier behavior was a defect.

**Calculations**

- A zero computed by an operator or a function keeps at most 100 decimal places instead of failing. `amount * (rate / 365) * (1/3) * (1/7)` returned `422` "Number exceeds supported precision or magnitude" only when `amount` was 0, and `$IFERROR` around it returned its fallback. A zero written with a larger scale is still refused.
- A number whose scale is below −100, such as `100E+2147483647`, returns `422` "Number exceeds supported precision or magnitude" instead of `500`, as an input, a default, a literal, a lookup entry or a `$TO_NUMBER` result.
- `$MODE` refuses more than 4,472 values with `422` "MODE compares every pair of values and accepts at most 4,472 values"; its pairwise comparison of 30 arrays of 9,801 cells held a thread for up to 29 s whatever the timeout.
- The functions that read dates (`$DAY`, `$MONTH`, `$YEAR`, `$WEEKDAY`, `$HOUR`, `$MINUTE`, `$SECOND`, `$DATE`, `$TIME`, `$DATEVALUE`, `$DAYS360`, `$TIMEVALUE`, `$VALUE`, `$TEXT`) refuse date text without a year with `422` "NAME: date text needs a year, such as "15 Jan 2026"", because Apache POI completed it with the year the server started (`$DATEVALUE`: the current year). Date text is read in UTC with the en-US locale whatever the server's settings; `$DAY("1/15/2020")` was 14 on a host in Asia/Shanghai.
- The argument limits of `$COMBIN`, `$FIXED`, `$DOLLAR`, `$TRUNC` and `$REPT` read numeric text, booleans and blanks as the function itself does: `$REPT("a", "3")` is `aaa` and `$TRUNC(x, null)` truncates to an integer, where both failed with "Expected a number".
- `$TEXT` with three or more sections or a condition writes one exponent sign and keeps literal text: `1.50E+00`, not `1.50E++00`.
- `$ERROR.TYPE` was made reference-only. [The final review](#behavior-changes-from-the-2026-10-01-final-review) reverted this, because every published version that mentions it stopped compiling.
- A value error that a source mapping raises after the deadline is reported as itself (`422`, named by the mapping), as in every other position; only a source mapping answered `504`.
- Branch analysis no longer depends on the order in which connections were drawn: a ladder of 13 or more checks was "too complex" in one drawing order and valid in another. [The final review](#behavior-changes-from-the-2026-10-01-final-review) keeps this and accepts again the "try the next tier" ladders this change made too complex.

**Data sources**

- An HTTP response head is bounded like the body: a header line longer than 16 KiB or more than 100 headers fails the read ("HTTP source failed", so `onError: DEFAULT` applies) instead of filling the server's memory.
- A host that resolves to several addresses tries the next address only while the call has time left. Each address got a fresh connect timeout, so a 10 s timeout over 8 stalled addresses lasted 70 s.
- A misspelled source parameter type returns `422` "Unknown input type", as for a rule input, instead of "Source parameters must be scalar".

**Requests and responses**

- A save (`PUT /rules/{id}`, `PUT /sources/{id}`) or a publication without `revision`, or with `"revision": null`, returns `422` "Revision is required" after the `404` check. It read as revision 0 and answered `409` however often the client reloaded.
- A multipart body is not parsed: it returns `415`, or the path's `404`, where a body without a boundary was a `500` on every path.
- `405` answers carry the `Allow` header, and `415` and `406` answers `Accept`.
- Catalog searches match within the ID, the name or the description of a rule, and within the ID or the name of a source: `tax rate` no longer finds the rule `tax` named "Rate table".
- A draft may call more than 65,535 rules; saving one was a `500`.
- Rule and source names made only of Unicode spaces such as U+3000 return `422` like blank names ("Rule name must contain 1 to 160 characters", "Source name must contain 1 to 160 characters").

**Drafts, diagnostics and ARC Script**

- Diagnostics of a graph whose source mappings form a cycle also list its connection and reachability problems; the cycle was the only problem reported.
- An ARC Script comment that contains a line break other than a newline (a lone CR, a form feed, a vertical tab, NEL, U+2028 or U+2029) builds as one note per line, the form a save stores and the code view shows.

**Startup**

- A sample rule ID that is already taken (by a rule created before the samples were seeded) no longer stops the API from starting: the samples are skipped with a warning and the workspace is not seeded again.

## Behavior changes from the second review

These changes shipped with [the second full review](reviews/2026-09-27-second-review.md), after the ones listed in the next section. As there, graph JSON, ARC Script, stored versions and pins are unchanged; results changed because the earlier behavior was a defect.

**Rule deletion and revisions**

- `revision` values are drawn from one sequence shared by all rules: a save or publish still advances a rule's revision, but by more than one, and a rule created again under a deleted ID starts above every revision that ID ever had. Clients that treat the revision as an opaque token are unaffected; a stale editor of the deleted rule now receives `409` instead of overwriting the new rule.
- `DELETE /rules/{id}` accepts an optional `revision` query parameter and answers `409` when the rule changed since that revision was read. The caller check now also counts a Reference without a version and `@id:version` calls in the source mappings of a draft without an Input node, and a caller saved or published concurrently can no longer slip past it.
- The sample rules are seeded once per workspace (recorded in the `workspace_seeds` table); deleting every rule and restarting the API no longer re-creates them.

**Graph checks and scopes**

- `POST /variables` checks only the structure a scope plan reads (node IDs and kinds, Switch cases, connections and input names). A draft whose only problems are content — a blank label, an oversized or unprefixed expression, a property its node kind does not use, an invalid default — reports every node's variables instead of failing, so one such problem no longer blanks every inspector. Invalid structure and cycles still return `422`.
- Branch analysis numbers its tests in an order derived from the graph's connections instead of the sort order of node IDs, so renaming or regenerating node IDs can no longer decide whether a graph is "too complex". Graphs that were rejected only because of their node IDs are accepted; the "Branch analysis is too complex" limit itself is unchanged.
- `POST /variables` no longer lists `""` as a variable downstream of a Formula, Transform or Reference whose result name is empty: an empty name is unset, as draft shape and the code view already read it, so a draft and its Code studio round trip report the same scopes.

**Formula calls**

- `$IFERROR`, `$ISERROR`, `$ISERR` and `$ISNA` no longer turn a called version that cannot be prepared into a fallback. A callee whose stored definition fails draft shape or compilation (a property its node kind does not use, an unprefixed function call), a missing pin or a pinned rule that is not a published Formula fails the request with the callee's own `422` or `404` and location, as a bare call already did; only the callee's value errors (`1 / 0`, `#N/A`) stay recoverable. A published caller that has answered its fallback since those checks tightened fails until the callee is republished.

**Excel functions**

- Arrays in the reference-class parameters that Excel reads as one value fail with `422` "NAME: argument N must be a single value, not an array", like value-class parameters: the index of `$VLOOKUP` and `$HLOOKUP`, `$MATCH`'s match type, the field of every database function (`$DSUM`, `$DGET`, …) and `$T`'s value. They silently used the array's first element before, so a published version that relied on that fails now.

**Node code and diagnostics**

- `POST /studio/node/build` refuses a fragment that contains a `//` comment with a diagnostic at the comment ("Comments belong to the whole graph; add them in Code studio") instead of dropping it silently, and a fragment header without `at (x, y)` keeps the node's position instead of moving it to (0, 0).
- `POST /diagnostics` runs every node check that needs no scope plan (a Switch without cases, Reference pins and parameter names, result variables, overwritten inputs) in a cyclic or too complex graph, and reports every missing connection and unreachable node instead of the first one; `POST /validate` still stops at the first problem.

**Data sources**

- An HTTP source URL with raw non-ASCII characters (`…/cities/Zürich?q=東京`) or a port outside 1–65535 is refused at save and at every read with `422` "Percent-encode non-ASCII characters in the URL as UTF-8 (Zürich → Z%C3%BCrich)" or "Use a port from 1 to 65535". Such URLs were sent with Latin-1 bytes and `?` characters, that is to another resource; a stored version that holds one fails its Test and executions (or uses its `DEFAULT` fallback) until it is saved percent-encoded.
- An HTTP definition with non-empty `entries` returns `422` "HTTP sources do not use lookup entries" (such entries were stored unbounded, and `{"a":1e5000}` made the create or update fail with `500`), and a LOOKUP definition with a non-blank `url` returns `422` "Lookup tables do not use a URL". Which optional fields a kind reads is declared once by its provider (`SourceAdapter.fields()`: `url` and `secretHeaders` for HTTP, `entries` for LOOKUP), and any other field that is set is refused before the provider's own checks; `timeoutMs` is outside that rule.
- A source save runs lock, revision check, validation, write, like a rule save: a stale `PUT /sources/{id}` answers `409` "Source changed in another editor; reload before saving" before its configuration is judged (a stale save with an invalid configuration answered `422`), and a save or a version read (`GET /sources/{id}/versions/{version}`) of an unknown source answers `404` "Source not found" like every other read of an unknown source (the save said "Data source not found").

**Errors and limits**

- A zero written with more than 100 decimal places or an exponent beyond ±100 (`0e-101`, `0.00 ^ 100`) fails with `422` "Number exceeds supported precision or magnitude" like any other out-of-range number, wherever numbers are bounded: literals, `$TO_NUMBER`, operator results, inputs, defaults, lookup entries and HTTP responses. Such zeros passed every bound before; `$TO_STRING` of one could allocate gigabytes, and one with more than 9,999 decimal places answered `500`. Integers with more than 100 significant digits in ARRAY/OBJECT values, lookup entries and HTTP responses fail the same way at save, Test or read, as decimals already did; `1E+100` and its 101-digit stored spelling keep working. A stored draft or version holding such a value fails until it is fixed.
- POI's number parsing is bounded like its wildcard matching: `$COUNTIF`/`$SUMIF` with a numeric criterion (`5`, `"5"`, `"=5"`), `$CORREL`, `$COVAR`, `$PEARSON` and `$FORECAST` over text cells that would need more than 10,000,000 character comparisons to parse fail with `422` "NAME: numeric text needs more than 10,000,000 character comparisons; use shorter text" before POI runs, instead of holding a request thread past the deadline.
- Type errors name ARC types instead of JDK classes: "Expected a boolean, got object" (or array, number, string, null), whatever the value's origin (a default, a supplied value or a literal).
- Unary minus is exact: negative literals, NUMBER constants and `-x` keep every digit instead of being rounded to 34 significant digits; binary arithmetic keeps DECIMAL128.
- `$GET` and `$PLUCK` text paths keep every segment, so a path with an empty segment (`"name."`, `"."`, `"a..b"`) returns the fallback instead of reading the prefix or the whole value, and a number path names one index or field (`3 / 2` is the field `"1.5"`, never `grid[1][5]`).
- `$REPT` measures the text POI repeats, so `$REPT(1E+2, 600)`, `$REPT(1 / 3, 100)` and `$REPT(blank, 600)` succeed whenever the result fits 2,000 characters, and `$REPT(1e10, 399)` fails with "REPT result exceeds string limit" instead of the generic string bound.
- Error responses are JSON with their documented status whatever the `Accept` header (they were an empty `500` for clients that accept only text); the body's fields keep one order (`status`, `message`, `issues`, `locations`), and `400` and `500` bodies carry an empty `locations` array too.
- Text with an unpaired UTF-16 surrogate (half of an escaped emoji, `"a\ud800b"`) is refused with `422` "Text cannot contain an unpaired UTF-16 surrogate" wherever U+0000 is, instead of being stored as `?`; a paged `search` containing U+0000 or such a surrogate returns `422` instead of `500`.
- Rule and source names share one policy: both are trimmed before validation and storage (a source name kept its padding), a name that is empty after trimming returns `422` "Rule name must contain 1 to 160 characters" (or "Source name …"), and a name holding a control character returns `422` "Rule name cannot contain control characters".
- A Reference node's `ruleId` must be a valid resource ID, like source pins and `@id:version` calls: a malformed one (`"Bad ID!"`, `""`, a NUL) fails with `422` at the node on save, build, validate, preview and diagnostics instead of saving and failing later as `404` or `500`; a stored draft that holds one fails until the rule is chosen again.
- Input and whole-document shape problems (a duplicate input, an invalid default, an over-limit input list) are located on the Input node from draft save and create, `/studio/render`, `/studio/node/render` and `/variables`, as `/validate` already did.
- A published execution that fails while preparing its version or checking source contracts names the rule and version in its root location, as runtime failures do; previews keep a null version.
- Input type errors read the same under every JVM default locale ("must be string", never "strıng").
- Validation, diagnostics and publishing check that every pinned version a graph reaches can still be prepared: a Reference or `@id:version` call to a version whose stored definition fails draft shape or compilation (a property its node kind does not use, an unprefixed function call) now fails with that version's `422` at the calling node, where it passed every static check and then failed every execution.
- The static nesting check walks a pin again when a longer call path reaches it, so a graph whose deepest reference chain exceeds 16 levels is rejected by validation, diagnostics and publishing whatever the order of its Reference nodes; such a graph was accepted before and failed every execution with "Rule nesting exceeds 16 levels". Published versions are unchanged and still fail at run time.
- A failed Reference binding or source-mapping argument names its position like the static diagnostics do: "amount: Division by zero" at the Reference node and "rate source / region: Division by zero" at the Input node; limits and the deadline keep their plain message.
- A deadline that expires while a pinned `@id:version` call inside a Switch case, a Transform field or a source mapping is being prepared keeps its message "Rule execution deadline exceeded" (it was prefixed with the position, "Route / Case Gold: …"); the `504`, its kind and its node location were already right.
- A draft's notes are stored as single trimmed lines, the only form an ARC Script comment can carry: a note with line breaks becomes one note per line, and a note that would render more than 500 comments fails with `422` "Too many or oversized comments" instead of making the code unbuildable. Stored drafts and versions are not rewritten.
- A draft saved through the API with two connections from the same handle to the same target (distinct edge IDs) now builds back from its Code studio text; "Duplicate connection" stays a validation problem at the node the connections leave.

## Behavior changes in this revision

These changes shipped with [the 2026-09-27 full review](reviews/2026-09-27-full-review.md). Graph JSON, the ARC Script text of complete graphs, stored versions and pins are unchanged; results listed here changed because the earlier behavior was a defect. Changes that editors see are listed in [the studio guide](studio.md#behavior-changes-in-this-revision).

**Errors and limits**

- `$IFERROR`, `$ISERROR`, `$ISERR`, `$ISNA` and source `DEFAULT` fallbacks no longer catch exhausted execution limits (1,000 steps, 16 nesting levels, 50 source reads, 10,000 expression operations). Such requests return `422` with the unchanged limit message instead of a fallback `200`. `$ISNA` and `$ISERR` classify by error kind: an ordinary error whose text mentions `#N/A` is `$ISNA` false and `$ISERR` true. A limit or deadline error inside a Transform field or Switch selector/case keeps its plain message, without a `Field x:` prefix.
- A value written only on a branch that was not taken in this execution is rejected at the join with `422` "Conflicting upstream values for '<name>'; use distinct result variable names before merging" instead of silently winning. Validation and publication are unchanged; this remains a runtime check.
- Inputs, sources and trace keys resolve in declared order, so external reads, the `sources` list, the Input trace keys and the first reported failure no longer vary across restarts or servers. Cycle errors are located on the nodes of the cycle.
- A published execution whose plan is cached no longer reads its version from the database. A Condition's missing-branch message always lists `[true, false]` in that order.

**Excel and expression functions**

- Wildcard criteria whose matching would read more than 10,000,000 characters in one call fail with `422` "NAME: wildcard criteria need more than 10,000,000 character comparisons; use fewer * or shorter text".
- Excel functions use the en-US locale and UTC regardless of the server's settings. `$TEXT` no longer depends on earlier calls; a multi-section format whose selected section cannot be applied returns `#VALUE!`.
- An array passed to a single-value Excel parameter fails with `422` "NAME: argument N must be a single value, not an array" (since [the second review](#behavior-changes-from-the-second-review), the reference-class parameters Excel reads as one value included). Empty arrays count as `0` for `ROWS`, `COLUMNS`, `COUNTA`, `COUNTBLANK`, `COUNTIF` and `SUMIF`, return `#N/A` from `MATCH`, `VLOOKUP`, `HLOOKUP` and `LOOKUP`, and fail elsewhere with `422` "NAME: Excel ranges cannot be empty". Excel results are plain numbers without a negative scale.
- `$CONCAT`, `$CONTAINS`, `$GET` and `$PLUCK` use canonical text: numbers are written plain, as `$TO_STRING` does (`Year 2020`, not `Year 2.02E+3`). `$CONCAT` skips nulls and rejects objects; `$CONTAINS` is false when either side is null; `$GET` and `$PLUCK` reject null or structured path keys.
- `$CONTAINS` rejects an object as the searched value (`422` "CONTAINS searches text or an array") and an array or object as the value to find in text (`422` "CONTAINS can only search text for a scalar value"); both used to compare Java text such as `{status=open}`.
- `==`, `!=`, `$SWITCH` and `$CONTAINS` compare nested lists and objects by value, so `[1] == [1.0]`. `$CHOOSE` evaluates only the chosen option and returns an array option whole. A property path ending in a dot or containing `..` (`customer.`, `customer..name`) is a syntax error instead of reading null.
- A direct `@id:version` Formula call returns the same multi-Output aggregate as a Reference node. Decimal bounds are checked by value, so a stored `1E+100` default keeps working.

**Data sources**

- HTTP sources block IPv6 forms that embed a private IPv4 address (IPv4-mapped, IPv4-compatible, NAT64 `64:ff9b::/96`, 6to4), every IPv6 address outside `2000::/3` (including local-use NAT64 `64:ff9b:1::/48`), Teredo `2001::/32`, benchmarking `2001:2::/48` and documentation `3fff::/20`, unless the exact hostname is listed in `ARC_HTTP_PRIVATE_HOSTS`.
- A configured query string is sent as written instead of being re-encoded; a supplied parameter replaces a configured pair of the same name. Non-2xx and oversized responses abort immediately. Number parameters are sent plain (`1200`, not `1.2E+3`).
- NUMBER lookup keys match by value, preferring the plain spelling (`"1"` over `"1.0"`); a null key fails with "Lookup key must not be null". JSON Pointer results keep their decimal scale (`100.0`), and a pointer without a leading `/` fails with `422` "Use a JSON pointer starting with /".
- Saving a LOOKUP definition with non-empty `secretHeaders` returns `422` "Lookup tables do not use secret headers", and a null secret-header name or alias is rejected for every kind. Versions stored earlier with such values now execute instead of failing with `500`.

**Requests and responses**

- Every request body is capped at 1 MiB for every method and path spelling, including `/api;x=1/…` and `/%61pi/…` (`413` "Request body exceeds 1 MiB"). Form bodies are not parsed.
- A duplicate rule or source ID returns `409` "This rule ID already exists" or "This source ID already exists" in the standard error shape (`issues` holds the message and `locations` is `[]`).
- `GET /sources/{id}/versions` for an unknown source returns `404` "Source not found" instead of `200 []`.
- Catalog searches are trimmed: a whitespace-only search returns every item, and the 200-character limit applies after trimming.
- JSON numbers are written plain: `$POWER(10, 2)` returns `100`, not `1E+2`.
- Text containing the NUL character (U+0000) returns `422` "Text cannot contain the NUL character (U+0000)", and text with an unpaired UTF-16 surrogate `422` "Text cannot contain an unpaired UTF-16 surrogate"; nothing is written.
- The API container's JVM runs with the en-US locale.
- New: `DELETE /rules/{id}` deletes a rule that no other rule calls; see [Delete a rule](#delete-a-rule). CORS allows `DELETE`.

**Drafts, diagnostics and ARC Script**

- Incomplete drafts render to canonical script that builds back to the same draft (`return;`, `when;`, `select;`, `let total;`, `use "rule-id";`) instead of invented code such as `when true;`. Complete graphs render byte for byte as before.
- Source-mapping problems name the mapping key (`rate source / region: …`), cyclic graphs keep their expression labels, and a broken source mapping no longer hides structural problems. Connection shape errors are reported on the connection's source node, also in draft-save `422` responses. Build errors carry the line and column of the statement that caused them.
- Connection IDs generated for code written without `edge "…"` change only when a node ID contains a hyphen or the ID would exceed 100 characters; such IDs keep a bounded prefix and add `~` and 16 hex digits.
- A draft node `version` without a `ruleId`, or below 1, returns `422`. An input-cycle message names the first declared input on the cycle.
- A node that sets a property its kind does not use returns `422` at that node, for example "Parameter bindings belong to Reference nodes" for bindings on a Formula, "Rule references belong to Reference nodes" for a `ruleId`, "Result variables belong to Formula, Transform and Reference nodes" for an Output's `output`, and "Expressions belong to Formula, Condition, Transform and Output nodes" for a Switch's `expression`. Such properties were ignored before. Saving, publishing, preview and execution all check them, so a stored draft or published version that still holds one fails until its draft is fixed and published again.

**Web server (port 3080)**

- nginx waits 40 s for the API, so the API's JSON `504` arrives instead of an nginx HTML `504`. It resolves the api container on each request, which survives an api container restart. `index.html` is not cached, hashed assets are cached as immutable, a missing asset returns `404` instead of `index.html`, and responses are gzip-compressed.
- A request body over 1 MiB answers a JSON `413` (`{"status":413,"message":"Request body exceeds 1 MiB","issues":[]}`) with `Access-Control-Allow-Origin: *`, so a browser client reads the error instead of an opaque CORS failure; a body of exactly 1 MiB reaches the API. Redirects from `/api` and `/assets` to their slash forms are relative (no `Location` with the container's port), and `/health` sends a single `Content-Type`. `scripts/web_smoke.py` checks these against a running web container.
