# Code studio and connected inputs

Open **Code studio** in the sidebar, or **Code editor** inside a rule. The graph and editor edit one draft. Use **Build graph** (Ctrl/Cmd+Enter), **Save draft** (Ctrl/Cmd+S), or **Graph view**. Syntax errors keep your code and leave the last built graph intact. Build can retain incomplete connections; Publish requires all paths and parameter bindings to be valid.

- Function chips: search, filter categories, hover for usage, click to insert.
- Modules: insert a formula, branch, output, input declaration, or source binding. Tab moves between snippet placeholders; otherwise it indents.
- Reuse: insert a published rule/formula with an exact version and required bindings.
- Outline: jump to a node declaration. Node positions and IDs survive code/graph changes.
- Comments use `//` and are retained at the top of canonical code.

Graph view uses the same functions. Select a Condition, Formula, Output, parameter mapping or Transform field and choose **Functions & editor** beside its expression. The dialog offers the grouped catalog, hover help, click-to-insert snippets, upstream-variable chips, completion and Tab indentation/placeholders. Apply changes that expression in the shared draft; Cancel preserves it. Syntax and unavailable-variable checks run as you edit; Test rule checks runtime values and types. Read-only versions allow inspection without applying edits.

Condition remains a True/False node. Use **Add node → Switch** for multiple branches or **Add node → Transform** for data shaping. Formula expressions can nest functions and process objects/arrays; they are not restricted to arithmetic. They still use ARC's bounded expression language, rather than arbitrary JavaScript or host code.

## Switch and data transformation

This example cleans an incoming object, converts a decimal string, and selects the first matching pricing branch:

```arc
inputs {
  customer: OBJECT required default {"name":"  Ada  ","amount":"150"};
}
node input INPUT "Inputs" { next -> normalize; }
node normalize TRANSFORM "Normalize customer" {
  field "displayName" = UPPER(TRIM(customer.name));
  field "amount" = TO_NUMBER(customer.amount);
  field "country" = COALESCE(customer.country, "US");
  as normalized;
  next -> choose;
}
node choose SWITCH "Pricing tier" {
  case premium "Premium" when normalized.amount >= 100;
  case standard "Standard" when normalized.amount >= 50;
  case:premium -> premium;
  case:standard -> standard;
  default -> regular;
}
node premium OUTPUT "Premium price" { return normalized.amount * 0.8; }
node standard OUTPUT "Standard price" { return normalized.amount * 0.9; }
node regular OUTPUT "Regular price" { return normalized.amount; }
```

The default inputs return `120`. Switch checks cases top to bottom; only the first true case runs, otherwise Default runs. Reordering cases changes priority but preserves their stable connections. Every exit needs a target. A selected exit may connect to several downstream nodes under the existing fan-out rules.

In Transform, add named fields and choose upstream values, typed constants or expressions. Field names are literal keys, including names containing dots. Fields share the incoming scope, so one field cannot reference another field being created. Access the resulting object in later nodes as `normalized.amount` or `GET(normalized, "amount")`. Use **Edit as one expression** to edit an object/array expression; the field mappings stay intact until a valid expression is applied. Whole-expression mode is also available in code:

```arc
node normalize TRANSFORM "Normalize items" {
  let normalized = MAP(FILTER(items, item, item.active), item,
    OBJECT("sku", item.sku, "price", ROUND(TO_NUMBER(item.price), 2)));
  next -> output;
}
```

This fragment requires an upstream `items` array and an `output` node. A transformation graph can be saved and published as an ordinary rule/formula, then reused from other graphs with versioned parameter mappings.

| Function | Behavior |
| --- | --- |
| `OBJECT("key", value, ...)` | Builds an object; duplicate keys are rejected; `OBJECT()` returns an empty object. |
| `MERGE(object, ...)` | Shallow merge into a new object; later fields replace earlier values. |
| `COALESCE(value, ..., fallback)` | First non-null value; short-circuits and retains `0`, `false` and empty text. |
| `TO_NUMBER(value)` | Decimal conversion from numeric text; retains precision and rejects invalid text. |
| `TO_STRING(value)` | Converts scalar values to text; rejects arrays/objects. |
| `TO_BOOLEAN(value)` | Accepts booleans or case-insensitive, trimmed `true`/`false` text. |

All three conversions preserve null. Use `COALESCE` for null defaults or `IFERROR` when invalid values should fall back. Existing `TRIM`, `UPPER`, `LOWER`, `SUBSTITUTE`, `GET`, `MAP`, `FILTER`, `PLUCK`, `REDUCE` and aggregates compose with these functions. Each expression remains limited to 2,000 characters and 256 tokens; split larger calculations into connected Formula/Transform nodes or reusable rules.

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
| POST | `/api/studio/expression/check` | `{ "expression": "..." }` → `{ valid, variables, error }`; parses only, never fetches data or evaluates values |
| GET / POST | `/api/sources` | List / create `{ id, name, definition }` |
| PUT | `/api/sources/{id}` | `{ name, revision, definition }` → new version |
| GET | `/api/sources/{id}/versions` | All configuration versions |
| GET | `/api/sources/{id}/versions/{version}` | Pinned configuration |
| POST | `/api/sources/{id}/test` | `{ version, inputs }` → `{ result }` |

Source definitions contain `kind` (`LOOKUP` or `HTTP`), `parameters`, and `timeoutMs` (HTTP: 100–10,000). LOOKUP adds `entries` and requires one parameter `key`; HTTP adds `url` and optional `secretHeaders`. HTTP responses and inbound API requests are limited to 1 MiB. Execution responses now include a `sources` array with input, sourceId, version, status and durationMicros.


### Node expressions and connections

Use the `</>` button on a canvas node, or **Node expression** in its inspector, to edit the whole node. A condition has a `when` expression; a formula has `let`; an output has `return`; a reused rule has `use`, `bind` and `as`. The Input node includes the rule’s parameters and source mappings. **Apply to graph** synchronizes the edit without saving or publishing. Syntax errors must be fixed before applying; other graph validation errors remain visible on the canvas while you finish the draft.

An edge is a connection: `next -> "output";` sends execution to that node; `true ->` and `false ->` select a condition branch; `case:premium ->` and `default ->` select Switch exits. The optional `edge "connection-id"` suffix preserves the connection’s identity during code/graph round trips; it is not a calculation. Several statements can connect one exit to multiple targets.

The function library groups entries by purpose (math, text, logic, statistics, dates, finance and others). Expand a group, or search to reveal matching functions. Referenced rules open their pinned versions in a single modal with **Back** and **Close all**.
