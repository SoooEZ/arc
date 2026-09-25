# HTTP API

Base URL: `http://localhost:8080/api` (also proxied by the workspace at `http://localhost:3080/api`). Send JSON with `Content-Type: application/json`. No JWT is required in this release.

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

Each source handle may have multiple downstream connections. Active nodes execute once after their predecessors are resolved. A single reached Output returns its value, as before. Multiple reached Outputs return an object keyed by Output node ID, for example `"result":{"tax":10,"shipping":5}`. Conditional branches that are skipped do not produce keys. Shared joins combine upstream values before calculating their expression.

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

For catalogs, use `GET /rule-summaries?offset=0&limit=20&search=tax&kind=FORMULA&publishedOnly=false`. It returns `{items,total,offset,limit}`. Each item contains rule metadata plus `nodeCount`, `inputCount`, and `referenceCount`, without `draft`. Search matches rule ID/name/description; `kind` and `publishedOnly` are optional filters. `offset` must be nonnegative and `limit` between 1 and 100 (default 20). Pages use a deterministic order; separate page requests do not form a frozen snapshot during concurrent edits.

Version pickers should use `GET /rules/{id}/version-summaries?offset=0&limit=20`, whose items contain `ruleId`, `version`, and `publishedAt`, newest first. Fetch the selected definition with `GET /rules/{id}/versions/{version}`. The legacy full `/rules` and `/rules/{id}/versions` endpoints remain compatible but are unbounded; workspace callers use the paginated summaries and on-demand details.

Data sources use the same page envelope and bounds: `GET /source-summaries?offset=0&limit=20&search=tax` returns `{id,name,version,kind}` items; `GET /sources/{id}/version-summaries` returns `{id,version,createdAt}` items. Load a selected configuration through `GET /sources/{id}/versions/{version}`. Legacy full source lists/history remain available for existing clients.

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
      {"id":"result","type":"OUTPUT","label":"Total with tax","position":{"x":280,"y":160},"expression":"round(amount * 1.08, 2)"}
    ],
    "edges": [{"id":"input-result","source":"input","target":"result","sourceHandle":"next"}]
  }
}
```

Supply the most recently read `revision`. A successful save advances it. A stale revision returns `409`; fetch the current rule and reconcile before retrying.

## Validate and preview

`POST /validate` accepts the graph document directly, and returns `{"valid":true}` for a complete graph. Invalid graphs return `422`; missing published dependencies return `404`.

`POST /preview` accepts `{"definition": {...}, "inputs": {...}}`. It runs an unsaved graph and returns the same execution structure, with `ruleId: "preview"` and `version: null`. Referenced rules must still be published and explicitly versioned.

`POST /variables` accepts a graph document and returns node IDs mapped to arrays of variable names guaranteed to be available at that node. It accepts incomplete acyclic drafts; it does not execute expressions, fetch sources or resolve referenced rules. The editor uses it for parameter mapping choices. Invalid structure or cycles return `422`.

## Publish and inspect versions

`POST /rules/{id}/publish` accepts `{"revision":2}`. It validates the current saved draft, creates a new immutable version, advances the edit revision, and returns the updated rule. Publishing invalid drafts never changes the live version.

- `GET /rules/{id}/versions`: version objects, newest first.
- `GET /rules/{id}/versions/{version}`: one immutable snapshot.
- Version objects contain `ruleId`, `version`, `definition`, and `publishedAt`.

The UI saves any changed draft before publishing. API clients should save explicitly, then publish using the returned revision.

## Errors

```json
{"status":422,"message":"Missing required input: orderTotal","issues":["Missing required input: orderTotal"],"locations":[{"ruleId":"preview","version":null,"nodeId":"input","label":"Inputs"}]}
```

`locations` identifies affected graph nodes, deepest failure first, followed by reference callers. Validation may use a null rule ID for the submitted graph. Errors outside a graph may omit locations or return an empty array.

| HTTP status | Meaning |
| --- | --- |
| `400` | Malformed JSON or invalid request value |
| `404` | Missing rule or published version |
| `409` | Duplicate rule ID, stale revision, or execution of an unpublished rule |
| `413` | Request body larger than 1 MiB |
| `422` | Invalid graph, expression, input, or calculation |
| `500` | Unexpected internal error (details are logged, not exposed) |
| `504` | Execution deadline exhausted, including across nested rules and source reads |

The current release has no deletion API, batch endpoint, run-history storage, or authentication. Rules and published versions persist; execution traces are returned to the caller rather than stored.

## Code studio and external parameters

See [the studio guide](studio.md) for ARC Script, the function catalog, source APIs, and HTTP configuration. Inputs additionally accept ARRAY and OBJECT types and optional versioned `source` bindings. Execution responses include a `sources` array describing fetches and defaults.
