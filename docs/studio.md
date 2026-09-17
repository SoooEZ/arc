# Code studio and connected inputs

Open **Code studio** in the sidebar, or **Code editor** inside a rule. The graph and editor edit one draft. Use **Build graph** (Ctrl/Cmd+Enter), **Save draft** (Ctrl/Cmd+S), or **Graph view**. Syntax errors keep your code and leave the last built graph intact. Build can retain incomplete connections; Publish requires all paths and parameter bindings to be valid.

- Function chips: search, filter categories, hover for usage, click to insert.
- Modules: insert a formula, branch, output, input declaration, or source binding. Tab moves between snippet placeholders; otherwise it indents.
- Reuse: insert a published rule/formula with an exact version and required bindings.
- Outline: jump to a node declaration. Node positions and IDs survive code/graph changes.
- Comments use `//` and are retained at the top of canonical code.

## Example

Create a rule, open its code editor, replace the script with this, then build and test:

```arc
schema 1;
inputs {
  amount: NUMBER required default 100;
  country: STRING required default "US";
  taxRate: NUMBER required;
  source taxRate = {"id":"country-tax","version":1,"bindings":{"key":"country"},"pointer":"/rate","onError":"FAIL"};
}
node input INPUT "Input" {
  next -> eligibility;
}
node eligibility CONDITION "Minimum amount" {
  when amount >= 100;
  true -> calculate;
  false -> rejected;
}
node calculate FORMULA "Add tax" {
  let total = ROUND(amount * (1 + taxRate), 2);
  next -> output;
}
node output OUTPUT "Total" {
  return total;
}
node rejected OUTPUT "Below minimum" {
  return 0;
}
```

The included `country-tax` lookup returns `{ "rate": 0.07, "currency": "USD" }` for `US`; `/rate` extracts the numeric value. `{ "amount": 100, "country": "US" }` returns `107`. Providing `taxRate` directly skips the source. Source arguments can refer to other inputs, but dependencies must not form a cycle. Errors, missing fields, null required values and wrong response types can use a configured non-null input default with `"onError":"DEFAULT"`.

## Formula examples

```text
SUM([0.1, 0.2], 0.3)
IF(amount >= 100, ROUND(amount * 0.9, 2), amount)
IFERROR(amount / count, 0)
SWITCH(tier, "premium", 0.2, "standard", 0.1, 0)
UPPER(LEFT(customer.name, 3))
VLOOKUP(2, [[1, 10], [2, 20]], 2, false)
SUM(MAP(items, item, item.price * item.quantity))
FILTER(items, item, item.price > 10)
ALL(items, item, item.price > 0)
ANY(items, item, item.discounted)
PLUCK(items, "price", 0)
GET(customer, "address.country", "US")
REDUCE(items, item, acc, 0, acc + item.price)
```

Function names are case insensitive. Variable names are case sensitive. Arithmetic supports `+ - * / % ^`; comparisons support `== = != <> < <= > >=`; boolean operators support `&& || !` and uppercase infix `AND OR`. The exponent operator accepts integers from -100 to 100. Strings use single or double quotes. Arrays use brackets. Core aggregates require numeric elements. Core `FLOOR`/`CEIL` take one argument; `ROUND`, `ROUNDDOWN`, `ROUNDUP` accept -12…12 places. Empty or missing object paths return null (`GET`/`PLUCK` accept a fallback).

`COMBIN` limits n to 10,000; `FIXED`/`DOLLAR`/`TRUNC` limit decimal places to -100…100 to bound work and output allocation.

The catalog lists functions known to the bundled Excel engine, with **Available** versus **Reference only** status. It does not claim all Microsoft 365 functions or complete Dentaku compatibility. Complex Excel calculations use Apache POI's Excel numeric semantics; core arithmetic/aggregates use decimal math. Rectangular matrix results are returned as nested arrays. Functions depending on workbook state are not supported. Consult the runtime catalog for the exact supported signatures.

## HTTP sources

In **Data sources**, create an HTTP provider with URL `https://api.example.com/customer`, and declare a STRING parameter `customerId`. In an Input node choose the provider, map its parameter to an input expression such as `customerId`, and set a JSON Pointer such as `/data/creditLimit`. The service calls `GET https://api.example.com/customer?customerId=...` with URL encoding.

For a private service, add its exact hostname to `ARC_HTTP_PRIVATE_HOSTS`. Set `ARC_HTTP_ALLOWED_HOSTS` to restrict all HTTP requests to specified hosts. Both are comma-separated server environment variables and are wired into Compose. Neither accepts wildcard patterns. If a source uses a secret header, its host must be in `ARC_HTTP_ALLOWED_HOSTS`.

For a header such as `Authorization`, save only `{ "Authorization": "CRM_TOKEN" }` in the source. Supply the complete header value via server environment `ARC_SECRET_CRM_TOKEN` (for example, `Bearer ...`). Add that environment variable to a local Compose override; do not commit secrets. Source configuration versions are immutable, but remote data and operator-supplied secrets remain live. HTTP POST, SQL connectors, OAuth token refresh, and retries are not included in this version.

A source can be tested before binding it to a rule. Saving edits creates a new version; existing published rules keep their pinned source version. Rebind and publish a rule when you want it to adopt the new configuration.

## API

| Method | Endpoint | Body / result |
| --- | --- | --- |
| GET | `/api/functions` | Function metadata, snippets, availability |
| POST | `/api/studio/build` | `{ "source": "..." }` → definition, canonical source, diagnostics |
| POST | `/api/studio/render` | Definition JSON → `{ "source": "..." }` |
| GET / POST | `/api/sources` | List / create `{ id, name, definition }` |
| PUT | `/api/sources/{id}` | `{ name, revision, definition }` → new version |
| GET | `/api/sources/{id}/versions` | All configuration versions |
| GET | `/api/sources/{id}/versions/{version}` | Pinned configuration |
| POST | `/api/sources/{id}/test` | `{ version, inputs }` → `{ result }` |

Source definitions contain `kind` (`LOOKUP` or `HTTP`), `parameters`, and `timeoutMs` (HTTP: 100–10,000). LOOKUP adds `entries` and requires one parameter `key`; HTTP adds `url` and optional `secretHeaders`. HTTP responses and inbound API requests are limited to 1 MiB. Execution responses now include a `sources` array with input, sourceId, version, status and durationMicros.
