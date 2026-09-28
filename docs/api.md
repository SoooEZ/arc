# HTTP API

Base URL: `http://localhost:8080/api` (also proxied by the workspace at `http://localhost:3080/api`). Send JSON with `Content-Type: application/json`. No JWT is required in this release. Responses write decimal numbers in plain notation, for example `20` and `0.0000001`, never exponent forms such as `2E+1`. See [the behavior changes in this revision](#behavior-changes-in-this-revision) for results that differ from earlier releases.

## Execute

`POST /rules/{id}/execute`

```json
{"inputs":{"orderTotal":150,"customerTier":"premium"},"version":1}
```

`version` is optional: omit it to run the latest published version. Only published versions can be executed by rule ID. Editing a draft has no effect on this endpoint.

The response includes `ruleId`, `version`, `result`, `durationMicros`, and `trace`. A trace step contains `ruleId`, `version`, `nodeId`, `label`, `type`, `value`, `branch`, and `depth`. A condition's branch is `"true"` or `"false"`; ordinary progression is `"next"`; an Output has `null`. Nested rules have `depth > 0` and their own pinned versions.

Both execute and preview accept optional `trace` and `timeoutMs` fields:

```json
{"inputs":{"orderTotal":150,"customerTier":"premium"},"version":1,"trace":false,"timeoutMs":5000}
```

`trace` defaults to `true`. Its serialized JSON array is bounded to 256 KiB and retains a prefix of complete steps. Responses add `traceEnabled`, `traceTruncated`, `executedSteps`, and `traceBytes`. A truncated trace does not truncate the final result or weaken the shared 1,000-step execution limit. When disabled, the trace is empty and `traceTruncated` is false. The editor and API playground expose the switch, indicate truncation, and reflect the options in their cURL examples. Graph highlights cover only retained trace steps.

`timeoutMs` defaults to 30,000 and accepts integers from 100 through 30,000. One deadline is shared by preparation, nested rules, expression evaluation and source reads; HTTP reads are capped by both the source timeout and the remaining execution time. Deadline exhaustion returns `504` and cannot be converted into a source fallback. Execution checks are cooperative at processing boundaries; this is not an infrastructure timeout for database drivers, JVM pauses or response transmission.

Responses add `timing: {preparationMicros, executionMicros, totalMicros}`. Preparation includes root-version lookup and static checks; execution includes parameter reads and graph evaluation. Server timing ends before HTTP response serialization/transfer. Existing `durationMicros` retains engine timing. The UI separately measures the browser request round trip, including response download and JSON parsing; it is not sent as a server response field.

Expressions can call a published Formula with `@rule-id:version(arguments)`. Arguments follow the pinned input order, and omitted trailing inputs use the callee's normal default/source rules. The callee must be a published `FORMULA`; the positive version is mandatory. Calls share the execution deadline, step/read/depth limits and trace with their parent. `$IFERROR` and the `$IS…` error functions handle value errors only: an exhausted shared limit fails the request with `422`, and the deadline with `504`. See [Formula calls in the editor](studio.md) for completion, hover and null/omission behavior.

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

For catalogs, use `GET /rule-summaries?offset=0&limit=20&search=tax&kind=FORMULA&publishedOnly=false`. It returns `{items,total,offset,limit}`. Each item contains rule metadata plus `nodeCount`, `inputCount`, and `referenceCount`, without `draft`. Search matches rule ID/name/description; surrounding whitespace is ignored, so a whitespace-only search returns the unfiltered page. `kind` and `publishedOnly` are optional filters. `offset` must be nonnegative (default 0) and `limit` between 1 and 100 (default 20). Every search is trimmed first and may then have at most 200 characters. Pages use a deterministic order; separate page requests do not form a frozen snapshot during concurrent edits.

Version pickers should use `GET /rules/{id}/version-summaries?offset=0&limit=20`, whose items contain `ruleId`, `version`, and `publishedAt`, newest first. Optional `search` (at most 200 characters) matches a trimmed literal substring of the version number: `search=2` matches versions 2, 12 and 20. An empty search returns all versions; `total` counts only matching versions, and pagination applies after filtering. Fetch the selected definition with `GET /rules/{id}/versions/{version}`. The legacy full `/rules` and `/rules/{id}/versions` endpoints remain compatible but are unbounded; workspace callers use the paginated summaries and on-demand details.

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

Supply the most recently read `revision`. A successful save advances it. A stale revision returns `409`; fetch the current rule and reconcile before retrying. Drafts may be incomplete, but a node's `version` needs a `ruleId` and must be at least 1; other values return `422`.

## Validate and preview

`POST /validate` accepts the graph document directly, and returns `{"valid":true}` for a complete graph. Invalid graphs return `422`; missing published dependencies return `404`. Expression problems name their position, for example `rate source / region: Variables unavailable on every incoming path: missing`.

`POST /preview` accepts `{"definition": {...}, "inputs": {...}}`. It runs an unsaved graph and returns the same execution structure, with `ruleId: "preview"` and `version: null`. A published rule may also use the ID `preview`, but its locations always carry a version, so recognize the preview root by `ruleId: "preview"` together with `version: null`. Referenced rules must still be published and explicitly versioned.

`POST /variables` accepts a graph document and returns node IDs mapped to arrays of variable names guaranteed to be available at that node. It accepts incomplete acyclic drafts; it does not execute expressions, fetch sources or resolve referenced rules. The editor uses it for parameter mapping choices. Invalid structure or cycles return `422`; a cycle error lists the nodes of one cycle in `locations`.

## Publish and inspect versions

`POST /rules/{id}/publish` accepts `{"revision":2}`. It validates the current saved draft, creates a new immutable version, advances the edit revision, and returns the updated rule. Publishing invalid drafts never changes the live version.

- `GET /rules/{id}/versions`: version objects, newest first.
- `GET /rules/{id}/versions/{version}`: one immutable snapshot.
- Version objects contain `ruleId`, `version`, `definition`, and `publishedAt`.

The UI saves any changed draft before publishing. API clients should save explicitly, then publish using the returned revision.

## Delete a rule

`DELETE /rules/{id}` removes the rule with its draft and every published version and returns `204` without a body. Afterwards every request for the rule returns `404`, including execution of a pinned version, and the ID can name a new rule. Data sources cannot be deleted.

A rule that another rule still calls, through a Reference node or an `@id:version` call in any draft or published version, is kept. The request returns `409` "Other rules call this rule: checkout (draft), checkout v3. Remove those calls before deleting it." The message names up to five callers; `issues` lists them all. Delete or change the callers first.

## Errors

```json
{"status":422,"message":"Missing required input: orderTotal","issues":["Missing required input: orderTotal"],"locations":[{"ruleId":"preview","version":null,"nodeId":"input","label":"Inputs"}]}
```

`locations` identifies affected graph nodes, deepest failure first, followed by reference callers. Validation may use a null rule ID for the submitted graph. A connection problem is located at the node the connection leaves, or at the node it enters when the source is missing; problems of the whole graph or its inputs are located at the Input node. Errors outside a graph may omit locations or return an empty array.

| HTTP status | Meaning |
| --- | --- |
| `400` | Malformed JSON or invalid request value |
| `404` | Missing rule, source or version |
| `409` | Duplicate rule or source ID (`This rule ID already exists`, `This source ID already exists`), stale revision, execution of an unpublished rule, or deletion of a rule that other rules call |
| `413` | Request body larger than 1 MiB, for any method or path |
| `422` | Invalid graph, expression, input, or calculation; exhausted execution limit (steps, nesting, source reads, expression operations); text containing the NUL character (U+0000), which storage cannot hold |
| `500` | Unexpected internal error (details are logged, not exposed) |
| `504` | Execution deadline exhausted, including across nested rules and source reads |

The current release has no batch endpoint, run-history storage, or authentication, and data sources cannot be deleted. Rules and published versions persist until the rule is deleted; execution traces are returned to the caller rather than stored.

## Code studio and external parameters

See [the studio guide](studio.md) for ARC Script, the function catalog, source APIs, and HTTP configuration. Inputs additionally accept ARRAY and OBJECT types and optional versioned `source` bindings. Execution responses include a `sources` array describing fetches and defaults. Entries appear in read order: an input's source dependencies are read first, in declaration order.

## Behavior changes from the second review

These changes shipped with [the second full review](reviews/2026-09-27-second-review.md), after the ones listed in the next section. As there, graph JSON, ARC Script, stored versions and pins are unchanged; results changed because the earlier behavior was a defect.

**Errors and limits**

- A zero written with more than 100 decimal places or an exponent beyond ±100 (`0e-101`, `0.00 ^ 100`) fails with `422` "Number exceeds supported precision or magnitude" like any other out-of-range number, wherever numbers are bounded: literals, `$TO_NUMBER`, operator results, inputs, defaults, lookup entries and HTTP responses. Such zeros passed every bound before; `$TO_STRING` of one could allocate gigabytes, and one with more than 9,999 decimal places answered `500`. Integers with more than 100 significant digits in ARRAY/OBJECT values, lookup entries and HTTP responses fail the same way at save, Test or read, as decimals already did; `1E+100` and its 101-digit stored spelling keep working. A stored draft or version holding such a value fails until it is fixed.
- POI's number parsing is bounded like its wildcard matching: `$COUNTIF`/`$SUMIF` with a numeric criterion (`5`, `"5"`, `"=5"`), `$CORREL`, `$COVAR`, `$PEARSON` and `$FORECAST` over text cells that would need more than 10,000,000 character comparisons to parse fail with `422` "NAME: numeric text needs more than 10,000,000 character comparisons; use shorter text" before POI runs, instead of holding a request thread past the deadline.

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
- An array passed to a single-value Excel parameter fails with `422` "NAME: argument N must be a single value, not an array". Empty arrays count as `0` for `ROWS`, `COLUMNS`, `COUNTA`, `COUNTBLANK`, `COUNTIF` and `SUMIF`, return `#N/A` from `MATCH`, `VLOOKUP`, `HLOOKUP` and `LOOKUP`, and fail elsewhere with `422` "NAME: Excel ranges cannot be empty". Excel results are plain numbers without a negative scale.
- `$CONCAT`, `$CONTAINS`, `$GET` and `$PLUCK` use canonical text: numbers are written plain, as `$TO_STRING` does (`Year 2020`, not `Year 2.02E+3`). `$CONCAT` skips nulls and rejects objects; `$CONTAINS` is false when either side is null; `$GET` and `$PLUCK` reject null or structured path keys.
- `==`, `!=`, `$SWITCH` and `$CONTAINS` compare nested lists and objects by value, so `[1] == [1.0]`. `$CHOOSE` evaluates only the chosen option and returns an array option whole. A property path ending in a dot, such as `customer.`, is a syntax error.
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
- Text containing the NUL character (U+0000) returns `422` "Text cannot contain the NUL character (U+0000)"; nothing is written.
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
