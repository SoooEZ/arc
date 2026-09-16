# HTTP API

Base URL: `http://localhost:8080/api` (also proxied by the workspace at `http://localhost:3080/api`). Send JSON with `Content-Type: application/json`. No JWT is required in this release.

## Execute

`POST /rules/{id}/execute`

```json
{"inputs":{"orderTotal":150,"customerTier":"premium"},"version":1}
```

`version` is optional: omit it to run the latest published version. Only published versions can be executed by rule ID. Editing a draft has no effect on this endpoint.

The response includes `ruleId`, `version`, scalar `result`, `durationMicros`, and `trace`. A trace step contains `ruleId`, `version`, `nodeId`, `label`, `type`, `value`, `branch`, and `depth`. A condition's branch is `"true"` or `"false"`; ordinary progression is `"next"`; an Output has `null`. Nested rules have `depth > 0` and their own pinned versions.

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

## Publish and inspect versions

`POST /rules/{id}/publish` accepts `{"revision":2}`. It validates the current saved draft, creates a new immutable version, advances the edit revision, and returns the updated rule. Publishing invalid drafts never changes the live version.

- `GET /rules/{id}/versions`: version objects, newest first.
- `GET /rules/{id}/versions/{version}`: one immutable snapshot.
- Version objects contain `ruleId`, `version`, `definition`, and `publishedAt`.

The UI saves any changed draft before publishing. API clients should save explicitly, then publish using the returned revision.

## Errors

```json
{"status":422,"message":"Missing required input: orderTotal","issues":["Missing required input: orderTotal"]}
```

| HTTP status | Meaning |
| --- | --- |
| `400` | Malformed JSON or invalid request value |
| `404` | Missing rule or published version |
| `409` | Duplicate rule ID, stale revision, or execution of an unpublished rule |
| `413` | Request body larger than 1 MiB |
| `422` | Invalid graph, expression, input, or calculation |
| `500` | Unexpected internal error (details are logged, not exposed) |

The current release has no deletion API, batch endpoint, run-history storage, or authentication. Rules and published versions persist; execution traces are returned to the caller rather than stored.
