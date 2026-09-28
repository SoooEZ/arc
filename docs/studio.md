# Code studio and connected inputs

Open **Code studio** in the sidebar (it opens the rule you are viewing, else the last rule you opened, else the most recently updated rule), or **Code editor** inside a rule. The graph and editor edit one draft. Use **Build graph** (Ctrl/Cmd+Enter), **Save draft** (Ctrl/Cmd+S), or **Graph view**. Syntax errors keep your code and leave the last built graph intact. Build can retain incomplete connections; Publish requires all paths and parameter bindings to be valid.

- Function chips: search, filter categories, hover for usage, click to insert.
- Modules: insert a formula, branch, output, input declaration, or source binding. Tab moves between snippet placeholders; otherwise it indents.
- Reuse: insert a published rule/formula with an exact version and required bindings. A card shows *loading…* while its version loads; each choice inserts one Reference node, and its generated node ID stays within the 80-character limit even for long rule IDs.
- Outline: jump to that node's declaration. Node IDs are case-sensitive; comments and strings are ignored. Node positions and IDs survive code/graph changes.
- Comments use `//` and are retained at the top of canonical code.

Graph view uses the same functions. Expression fields in Condition, Switch, Formula, Output, parameter mappings and Transform use inline code editors. Functions use a `$` prefix: `$ROUND(amount, 2)`. Variables have no prefix, so `$SUM(SUM)` calls the function with an input named `SUM`. Typing `$` suggests built-in functions; typing `@` searches published Formula rules once you pause typing. Ordinary identifiers suggest available upstream variables and supported functions. **Tab** accepts a suggestion, moves between inserted function arguments, or indents when no suggestion is active. **Ctrl/⌘ Space** opens suggestions manually. Operators display their individual characters, including both signs in `==`, in every code surface: editors, canvas previews and JSON fields. A value keeps the control you are typing in: a cleared or half-typed constant stays a constant, and the Condition builder stays a builder while an operand is incomplete. Switch with the value-source menu or **Builder**/**Expression**. Number and array constants that ARC cannot read, such as `.5e3` or `[1, 2,`, are marked at the field; a stored value in that form opens as an expression.

Expression colors distinguish built-in functions (ochre), input parameters (blue), computed node results (purple), and published Formula calls (teal). Hover an input or result to see its type and producing node; hover a Formula call to see its pinned version and parameter contract. Collection-local names keep a neutral color, including when they shadow an input. Only the root of a dotted path is classified: `customer` is the input in `customer.amount`; `amount` is an object property. Strings and comments keep their own colors. Inline expression colors use the available upstream scope. Full code views show declaration roles; validation still determines whether a value is available at a particular node.

A Formula node's output, such as `discountedAmount`, is an already computed value that downstream expressions can read. To call a published Formula from the rule library inside an expression, use `@rule-id:version(arguments)`, for example `$ROUND(@apply-discount:1(amount, rate), 2)`. The editor's **Published formulas** picker and `@` completion insert a pinned call. The picker searches published Formulas and loads more results as you scroll; it preserves loaded cards and offers Retry if a page fails. The stable rule ID and a positive published version are required; display names and floating latest versions are not callable. Only library entries of kind Formula can be called this way. Reference nodes remain available for explicit graph-level reuse of any rule kind.

Arguments follow the input declaration order in that published version. Trailing inputs may be omitted when their required/default/source contract permits it; omitted values use normal defaults or data sources. Explicit `null` remains an explicit value and does not request a default or source. To use a later input, supply all earlier arguments. Republish a called Formula to create a new version, then explicitly update callers' pins to adopt it. Calls work in all expression fields, including source parameter mappings and collection bodies. Lazy functions such as `$IF` execute only the selected branch. Child execution shares the caller's trace, deadline, depth, step and source-read limits. Required arguments and bindings without a default start as a type-correct placeholder: `0`, `"value"`, `false`, `[]` or `$OBJECT()`.

Choose **Open in Editor** for a larger editor with the grouped catalog, hover help, click-to-insert snippets and upstream-variable chips. Apply changes that expression in the shared draft; Cancel preserves it. Syntax, Formula pin/argument-count and unavailable-variable checks run as you edit in the dialog; Test rule checks runtime values and types. Read-only versions allow inspection without applying edits. The preview panel's **Input JSON** and the published API playground also use code editors with Tab/Shift+Tab indentation and bracket matching. Incomplete JSON stays editable; running checks the current buffer. Monaco's **Ctrl+M** (**Ctrl+Shift+M** on macOS) toggle lets Tab move focus out of the editor when needed.

Condition remains a True/False node. Use **Add node → Switch** for multiple branches or **Add node → Transform** for data shaping. Formula expressions can nest functions and process objects/arrays; they are not restricted to arithmetic. They still use ARC's bounded expression language, rather than arbitrary JavaScript or host code.

## Switch and data transformation

Select a Switch and choose its **Switch mode**. Both modes check cases from top to bottom and follow only the first match. Reordering cases changes their priority while preserving connections. **Default** runs when no case matches. Every exit needs a target; an exit may also connect to several downstream nodes under the existing fan-out rules.

### Conditions and ranges

**Conditions · first true case** gives every case a boolean condition. For a range, put `amount < 50` first and `amount < 100` second. The second case is reached only after the first fails, so `amount >= 50` is implicit. Default covers `amount >= 100`.

Paste this complete script into a rule's code editor, build, and test. The default amount `75` returns `2`; amounts below `50` return `1`, and amounts of `100` or more return `3`.

```arc
schema 1;
inputs {
  amount: NUMBER required default 75;
}
node input INPUT "Input" { next -> choose; }
node choose SWITCH "Amount range" {
  case below50 "Below 50" when amount < 50;
  case below100 "50 to below 100" when amount < 100;
  case:below50 -> output1;
  case:below100 -> output2;
  default -> output3;
}
node output1 OUTPUT "Output 1" { return 1; }
node output2 OUTPUT "Output 2" { return 2; }
node output3 OUTPUT "Output 3" { return 3; }
```

### Match a value

**Match a value** adds **Value to match**. Select an upstream variable, a typed constant or an expression, then configure each case's value using the same controls. Boolean, number and string values are supported. Types stay distinct: `1`, `"1"` and `true` do not match each other; decimal numbers `1` and `1.0` do match. String constants are entered as ordinary text in the form; ARC Script requires quotes.

In code, `select` declares the value to match and `equals` declares each case value. This complete example returns `2` for the default tier `"standard"`, `1` for `"premium"`, and `3` for any other string:

```arc
schema 1;
inputs {
  tier: STRING required default "standard";
}
node input INPUT "Input" { next -> choose; }
node choose SWITCH "Customer tier" {
  select tier;
  case premium "Premium" equals "premium";
  case standard "Standard" equals "standard";
  case:premium -> output1;
  case:standard -> output2;
  default -> output3;
}
node output1 OUTPUT "Output 1" { return 1; }
node output2 OUTPUT "Output 2" { return 2; }
node output3 OUTPUT "Output 3" { return 3; }
```

The selector runs once. Cases are evaluated in order and stop at the first match, so later expressions do not run. A selector or reached case that returns null, an array or an object produces a `422` execution error at the Switch node. Without `select`, cases continue to use boolean `when` conditions. Do not mix `when` and `equals` cases in one node. `select` can appear before or after the cases without changing their meaning; the order of the cases sets priority. The **Switch cases** and **Switch values** modules insert templates for each mode.

### Default return

If Default is connected directly to one Output with no other incoming connection, **Default return value** edits that Output inline. If Default is unconnected, **Add default return** creates and connects an Output, then shows its return value controls. The value can be a variable, typed constant or expression, with the same optional **Output name** as the connected Output.

If Default already leads to another kind of node, multiple targets or a shared Output, the form shows those destinations. Edit the destination node to change its behavior; the inline control preserves existing routing and shared results. In code, Default continues to use `default -> output3;` and the destination Output's `return` expression.

### Transform before branching

This example cleans an incoming object, converts a decimal string, and selects the first matching pricing branch:

```arc
inputs {
  customer: OBJECT required default {"name":"  Ada  ","amount":"150"};
}
node input INPUT "Inputs" { next -> normalize; }
node normalize TRANSFORM "Normalize customer" {
  field "displayName" = $UPPER($TRIM(customer.name));
  field "amount" = $TO_NUMBER(customer.amount);
  field "country" = $COALESCE(customer.country, "US");
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

The default inputs return `120` through the first matching pricing branch.

In Transform, add named fields and choose upstream values, typed constants or expressions. Field names are literal keys, including names containing dots. Fields share the incoming scope, so one field cannot reference another field being created. Access the resulting object in later nodes as `normalized.amount` or `$GET(normalized, "amount")`. Use **Edit as one expression** to edit an object/array expression; the field mappings stay intact until a valid expression is applied. Whole-expression mode is also available in code:

```arc
node normalize TRANSFORM "Normalize items" {
  let normalized = $MAP($FILTER(items, item, item.active), item,
    $OBJECT("sku", item.sku, "price", $ROUND($TO_NUMBER(item.price), 2)));
  next -> output;
}
```

This fragment requires an upstream `items` array and an `output` node. A transformation graph can be saved and published as an ordinary rule/formula, then reused from other graphs with versioned parameter mappings.

| Function | Behavior |
| --- | --- |
| `$OBJECT("key", value, ...)` | Builds an object; duplicate keys are rejected; `$OBJECT()` returns an empty object. |
| `$MERGE(object, ...)` | Shallow merge into a new object; later fields replace earlier values. |
| `$COALESCE(value, ..., fallback)` | First non-null value; short-circuits and retains `0`, `false` and empty text. |
| `$TO_NUMBER(value)` | Decimal conversion from numeric text; retains precision and rejects invalid text. |
| `$TO_STRING(value)` | Converts scalar values to text; rejects arrays/objects. |
| `$TO_BOOLEAN(value)` | Accepts booleans or case-insensitive, trimmed `true`/`false` text. |

All three conversions preserve null. Use `$COALESCE` for null defaults or `$IFERROR` when invalid values should fall back. Existing `$TRIM`, `$UPPER`, `$LOWER`, `$SUBSTITUTE`, `$GET`, `$MAP`, `$FILTER`, `$PLUCK`, `$REDUCE` and aggregates compose with these functions. Each expression remains limited to 2,000 characters and 256 tokens; split larger calculations into connected Formula/Transform nodes or reusable rules.

`$IFERROR`, `$ISERROR`, `$ISERR` and `$ISNA` handle value errors only; an exhausted execution limit or the deadline still fails the request. `$ISNA` is true only for an Excel #N/A result, such as an unmatched `$MATCH`, and never because an error message mentions "#N/A".

`$CONCAT`, `$CONTAINS`, `$GET` and `$PLUCK` read numbers as `$TO_STRING` writes them: `$CONCAT("Year ", $YEAR(date))` is `Year 2020`, and `$GET(items, 10.0)` reads index 10. `$CONCAT` skips null and rejects objects. `$CONTAINS` is false when the text or the searched value is null; with an array it tests membership, comparing arrays and objects by value. `$GET`/`$PLUCK` need a text or number path.

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
  let total = $ROUND(amount * (1 + taxRate), 2);
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

Unfinished JSON defaults and numeric defaults outside the server's number limits (at most 100 significant digits and 100 decimal places; like the server, trailing zeros may be dropped first, so `1e100` is accepted and `1e101` is not) show an error and block saving, node changes and code-view navigation until corrected or removed. Numeric fields accept equivalent decimal and exponent notation and keep every entered digit: a default such as `9007199254740993`, which a JavaScript number would round, is saved exactly. JSON default fields keep your text while you type. At least one node must remain in a draft, even while its graph is incomplete.

Every built-in function call must use `$FUNCTION(...)`; published Formula calls use `@rule-id:version(...)`. Unprefixed calls are rejected in new and existing expressions, including published versions and source bindings. Update old drafts to add the prefix to calls, publish a new version, and update any parent references that pin the old version. Historical snapshots are not rewritten. Quoted strings retain their literal text; do not prefix function-like text inside a string.

A rule’s permanent **Rule ID** uses 1–80 lowercase letters, digits or hyphens and starts with a letter. Spaces, `$` and `@` are forbidden. The create dialog rejects those characters when typing or pasting; its ID suggestion stays valid when the display name starts with a number and follows the name only until you type your own ID (clearing the ID resumes suggestions). Rule display names remain separate from IDs.

Input/source parameter names, result variable names and optional Output names use 1–64 letters, digits or underscores, starting with a letter or underscore. Spaces, `$` and `@` are not allowed; `true`, `false`, `null`, `and` and `or` are reserved regardless of case. Parameter/result-name fields reject prohibited typing and pasted whitespace, and source-parameter JSON reports invalid names before saving. A name stored before these checks can be shortened or repaired in place: the field accepts deletions and letters, digits or `_`, and shows the guidance until the name is valid. The server enforces the same syntax on draft saves, Script builds and execution. Node display names, object keys and string values are separate from parameter identifiers.

```text
$SUM([0.1, 0.2], 0.3)
$IF(amount >= 100, $ROUND(amount * 0.9, 2), amount)
$IFERROR(amount / count, 0)
$SWITCH(tier, "premium", 0.2, "standard", 0.1, 0)
$UPPER($LEFT(customer.name, 3))
$VLOOKUP(2, [[1, 10], [2, 20]], 2, false)
$SUM($MAP(items, item, item.price * item.quantity))
$FILTER(items, item, item.price > 10)
$ALL(items, item, item.price > 0)
$ANY(items, item, item.discounted)
$PLUCK(items, "price", 0)
$GET(customer, "address.country", "US")
$REDUCE(items, item, acc, 0, acc + item.price)
```

Function names are case insensitive. Variable names are case sensitive. Arithmetic supports `+ - * / % ^`; comparisons support `== = != <> < <= > >=`; boolean operators support `&& || !` and uppercase infix `AND OR`. The exponent operator accepts integers from -100 to 100. Strings use single or double quotes. Arrays use brackets. Core aggregates require numeric elements. Core `$FLOOR`/`$CEIL` take one argument; `$ROUND`, `$ROUNDDOWN`, `$ROUNDUP` accept -12…12 places. Empty or missing object paths return null (`$GET`/`$PLUCK` accept a fallback). A property path needs a name after every dot (`customer.` is a syntax error).

`$COMBIN` limits n to 10,000; `$FIXED`/`$DOLLAR`/`$TRUNC` limit decimal places to -100…100 to bound work and output allocation. Wildcard criteria are limited to 10,000,000 character comparisons per call, so a pattern such as `"*a*a*a*b"` over long text fails like an invalid argument instead of running indefinitely. The same budget covers the numeric text that `$COUNTIF`/`$SUMIF` with a numeric criterion, `$CORREL`, `$COVAR`, `$PEARSON` and `$FORECAST` parse, so a range of long digit strings fails the same way. `$CHOOSE` evaluates only the chosen value, like Excel.

The catalog lists functions known to the bundled Excel engine, with **Available** versus **Reference only** status. It does not claim all Microsoft 365 functions or complete Dentaku compatibility. Complex Excel calculations use Apache POI's Excel numeric semantics; core arithmetic/aggregates use decimal math. Excel functions take arrays only where Excel takes a range; they use en-US formatting and UTC dates on every server. Rectangular matrix results are returned as nested arrays. Functions depending on workbook state are not supported. Consult the runtime catalog for the exact supported signatures.

## HTTP sources

In **Data sources**, create an HTTP provider with URL `https://api.example.com/customer`, and declare a STRING parameter `customerId`. In an Input node choose the provider, map its parameter to an input expression such as `customerId`, and set a JSON Pointer such as `/data/creditLimit`. The service calls `GET https://api.example.com/customer?customerId=...` with URL encoding. Query text already in the configured URL is sent exactly as written. Number parameters use plain decimal text, as `$TO_STRING` does.

For a private service, add its exact hostname to `ARC_HTTP_PRIVATE_HOSTS`. Set `ARC_HTTP_ALLOWED_HOSTS` to restrict all HTTP requests to specified hosts. Both are comma-separated server environment variables and are wired into Compose. Neither accepts wildcard patterns. If a source uses a secret header, its host must be in `ARC_HTTP_ALLOWED_HOSTS`.

For a header such as `Authorization`, save only `{ "Authorization": "CRM_TOKEN" }` in the source. Supply the complete header value via server environment `ARC_SECRET_CRM_TOKEN` (for example, `Bearer ...`). Add that environment variable to a local Compose override; do not commit secrets. Source configuration versions are immutable, but remote data and operator-supplied secrets remain live. HTTP POST, SQL connectors, OAuth token refresh, and retries are not included in this version.

A source can be tested before binding it to a rule. Saving edits creates a new version; existing published rules keep their pinned source version. Rebind and publish a rule when you want it to adopt the new configuration.

## API

| Method | Endpoint | Body / result |
| --- | --- | --- |
| GET | `/api/functions` | Function metadata, snippets, availability |
| POST | `/api/studio/build` | `{ "source": "..." }` → definition, canonical source, diagnostics |
| POST | `/api/studio/render` | Definition JSON → `{ "source": "..." }` |
| POST | `/api/studio/expression/check` | `{ "expression": "..." }` → `{ valid, variables, error, formulaCalls }`; parses dependencies and validates Formula kind/pin/argument count, never fetches source values or evaluates expressions. Each call metadata entry is `{id, version, argumentCount}` |
| GET / POST | `/api/sources` | List / create `{ id, name, definition }` |
| PUT | `/api/sources/{id}` | `{ name, revision, definition }` → new version |
| GET | `/api/sources/{id}/versions` | All configuration versions |
| GET | `/api/sources/{id}/versions/{version}` | Pinned configuration |
| POST | `/api/sources/{id}/test` | `{ version, inputs }` → `{ result }` |

Source definitions contain `kind` (`LOOKUP` or `HTTP`), `parameters`, and `timeoutMs` (HTTP: 100–10,000). LOOKUP adds `entries` and requires one parameter `key`; HTTP adds `url` and optional `secretHeaders`. LOOKUP definitions cannot carry `secretHeaders`. A NUMBER key matches the entry for the same number in any notation: `20`, `20.0` and `2E+1` find `"20"`, or an entry written `"20.0"` when there is no `"20"`. STRING and BOOLEAN keys match their exact text. A null key fails, so the input's `DEFAULT` fallback can apply. Source parameters are STRING, NUMBER or BOOLEAN. The Source ID of a new source follows the Rule ID policy, and an ID that already exists returns `409` "This source ID already exists". The HTTP timeout field accepts whole milliseconds from 100 to 10,000 and blocks saving other values. HTTP responses and inbound API requests are limited to 1 MiB. Execution responses now include a `sources` array with input, sourceId, version, status and durationMicros.


### Node expressions and connections

Clicking a node opens its inspector. The header keeps the node icon, inline **Node name** field and `</>` action in one row, with the node type below its icon. Editing the name updates the canvas label immediately. The header groups the code and **Delete node** icons at the right, with hover labels; Input cannot be deleted. Canvas code and reference icons likewise stay together. Inspector sections use bold headings and start expanded; click a heading to collapse its section. Every section has an info icon that explains its controls on hover or keyboard focus. **Available variables** appears above each expression editor, only when that editor is shown. Hover the text for a preview above the editor, or click to pin that list above it. You can keep editing or click elsewhere while it stays open; only its **X** closes it. Leaving the owning expression removes its panel. Formula, Reference and Transform result names live under **Output As**. Variable choices follow connected upstream paths, including the path from Input. Connect a new Switch to Input or an upstream calculation before choosing its variables; disconnected nodes have none. **Open in Editor** shows the same available names for expressions. Variable dropdowns display **value_name** [value_type] *from* **source_name**, with a muted italic “from”; computed outputs with no declared type use `result`. The chosen value uses the same formatting.

When only one Output runs, its optional **Output name** wraps the chosen return value in an object. For example, selecting `total` and naming the output `payable` returns `{"payable": 42}` when total is 42. Leave the name blank to return 42 directly. The name applies to variables, constants and expressions and survives graph/code editing, saving and publication. In ARC Script, use `return total; as payable;`. When multiple Outputs run, each raw value uses **Output name** as its field key, otherwise the directly returned variable name, otherwise the node ID. For example, returning `amount` and naming another Output `payable` produces `{"amount": 100, "payable": 42}`. Named Outputs add no extra wrapper in this object. Give constants, property paths and compound expressions an Output name when you want a meaningful field instead of the node-ID fallback. Duplicate keys among reached Outputs produce an error identifying both nodes; skipped branches do not conflict. The rule applies to existing published versions as well as drafts, without rewriting their saved definitions. The return preview labels the single-Output value separately from its field in a multiple-Output result, showing the actual outer key whenever the graph has other Outputs. The runtime includes only reached Outputs; simply having several Output nodes does not mean all will execute.

Input cards’ **Value provider** dropdown searches source names and IDs as you type and appends more matches when you scroll near the bottom. **Caller / default value** remains available while searching. Failed page loads retain existing results and offer Retry; selecting or filtering catalog entries never silently changes an existing version pin.

Reference nodes use **Select Rule** for the published rule and version. Its heading contains an open icon for viewing the selected pin and an info icon explaining version pinning. **Parameters for Rule** shows one card per declared input, with its required/optional status and type. Both Input and Reuse rule cards show the parameter name in bold without a decorative icon; mapping controls still accept an upstream variable, constant, expression, or the callee’s default/source.

Right-click a canvas node and choose **Edit** to open its settings in a wider form dialog. **Apply to graph** applies the form changes to the draft; **Cancel** discards them. **Delete** removes the node and its connections. Choose **Rename** to focus and select the name in the inspector header. The Input node can be renamed but cannot be deleted. Mutating menu actions are disabled for read-only versions.

Node errors are grouped behind one header icon. Hover to inspect all messages, or click to keep the list open until you close it. The list floats over the editor so diagnostics do not move the form.

Right-click a connection and choose **Delete** to remove that connection while keeping its endpoint nodes and all other connections. Changes stay in the draft until saved. Deletion is disabled in historical versions and while a document command is pending.

Use the `</>` button on a canvas node, or **Node expression** in its inspector, to edit the whole node as ARC Script. A condition has a `when` expression; a Switch has `case ... when` or `select` with `case ... equals`; a formula has `let`; an output has `return`; a reused rule has `use`, `bind` and `as`. The Input node includes the rule’s parameters and source mappings. **Apply to graph** synchronizes the edit without saving or publishing. Syntax errors must be fixed before applying; other graph validation errors remain visible on the canvas while you finish the draft.

Unfinished nodes keep their gaps in code. Omit a statement for a value you have not set, or leave the value empty: `let total;` has a result name but no expression, `let = amount * 2;` has an expression but no name, and `return;`, `when;`, `select;`, `field "name" =;`, `bind rate =;` and `case id "Label" when;` hold empty values. `use "rule-id";` keeps a chosen rule before you pick its version. Builds accept these drafts; validation still reports the missing parts until you fill them in. Problems such as a label over 160 characters or a connection to a missing node are reported at the statement that declares them.

An edge is a connection: `next -> "output";` sends execution to that node; `true ->` and `false ->` select a condition branch; `case:premium ->` and `default ->` select Switch exits. The optional `edge "connection-id"` suffix preserves the connection’s identity during code/graph round trips; it is not a calculation. Several statements can connect one exit to multiple targets. A connection written without `edge "…"` gets the ID `source-handle-target`, for example `input-next-calc`. When a node ID contains a hyphen, or the ID would exceed 100 characters, the generated ID keeps a shortened prefix and adds a short digest after `~`, so every connection stays unique.

The function library groups entries by purpose (math, text, logic, statistics, dates, finance and others). Expand a group, or search to reveal matching functions. Referenced rules open their pinned versions in a single modal with **Back** and **Close all**.

## Catalog and execution controls

The library, rule/source selectors and version histories use bounded summary pages with search or Previous/Next controls. Opening a selected item fetches its full definition; published versions remain read-only, and changing selection cancels obsolete detail reads. See [the paginated API contracts](api.md#create-and-edit).

Preview and the published API playground offer **Include execution trace** and **Execution timeout**. These choices are included in the generated cURL request. Trace defaults on and is capped at 256 KiB; a warning identifies partial traces and graph highlights, while the computed result stays complete. Turning trace off returns no intermediate steps and preserves all execution limits. Changing options invalidates any pending result. The cURL example shows the current input buffer with every digit; while the buffer is not a JSON object, it shows `"inputs": {}`, and the playground warns until the JSON is fixed. The Test panel keeps its inputs, options, selected tab and result when you switch between Graph view and Code editor and while code has unbuilt edits (Run waits for a build). Closing the panel clears the result and any pending run but keeps your inputs and options. An input buffer you have not edited follows the rule's inputs; once edited it is kept. Moving cards keeps the result and the highlighted path.

Results display browser request time and server preparation/execution times separately. The server timeout defaults to 30 seconds and is shared across nested rules and source reads; deadline exhaustion returns `504`, including when a source has a default fallback. A shorter per-source timeout still follows that source's configured failure policy.

## Behavior changes in this revision

These editor changes shipped with [the 2026-09-27 full review](reviews/2026-09-27-full-review.md). Changes to API results, error messages, data sources and ARC Script rendering are listed in [the API reference](api.md#behavior-changes-in-this-revision).

**Numbers**

- Values that a JavaScript number cannot carry exactly, such as `9007199254740993`, 34-digit decimals or `1e400`, stay exact end to end: responses, defaults, test inputs, lookup entries, displays and exports. Numeric defaults accept such numbers and block exactly what the server rejects: more than 100 significant digits or a scale beyond ±100, even without trailing zeros. `1e400`, `5e-324` and `Number.MAX_VALUE` are blocked; `1e100` is accepted and keeps saving after PostgreSQL stores it written out.

**Resilience**

- A response that cannot be read shows an API error instead of blanking the application. A module that fails to load, or a render error, shows a local error (Try again, Close or a reload notice) while the rest of the workspace and the draft stay open. Graph editing works on plain-HTTP origins other than localhost.

**Navigation**

- Leaving with unsaved rule or source edits, or while a save, publish or source save is pending, asks once with all messages; leaving the Data sources page with unsaved edits asks "Discard unsaved data source changes?". Cancelling a prompt no longer damages browser history. A graph/code switch of the same rule asks only for work it would discard, such as an embedded source manager, not for the rule's pending save. Closing or reloading the page asks for every active guard.
- **Code studio** in the sidebar opens the rule in view, else the last rule you opened, else the newest rule, whatever the library filter shows.

**Editor**

- Save and publish keep the local draft when the server's copy is the same, so test inputs, results and diagnostics are not reset. The Test panel keeps inputs, options, tab and result across view switches and code edits, and moving cards keeps the result and the highlighted path. Arrange no longer waits for the viewport fit.
- One node dialog opens at a time, with Cancel while it loads and Close if it fails. Version history refreshes after a publish. The selection falls back to the default node when its node disappears. Drafts created through the API without node positions open at (0, 0) without becoming unsaved. Export keeps its download URL valid for 40 s.
- **Rule settings** can delete the rule. The dialog asks first, and a published rule also asks for its ID, because API clients call it by that ID. Deleting removes the draft and every version and returns to the library without asking about unsaved changes. A rule that other rules call stays, and the dialog names the callers.

**Inspector**

- Binding controls keep the chosen mode and constant type while you edit. Literal detection matches the server: `.5e3`, `1.`, `1.e5`, a backslash before a line break, arrays of objects and no-break-space padding open as expressions, and `and`/`or` or identifiers longer than 64 characters are expressions, not variables. Identifier fields accept deletions in stored invalid names. Parameters named like object members, such as `constructor` or `__proto__`, work everywhere.
- A node that sets a property its kind does not use, such as parameter bindings on a Formula, shows which ones above its sections, and **Remove** clears them from the draft. The server rejects such nodes when saving, publishing, previewing and executing, so a published version that still holds one fails until a fixed draft is published.

**Code studio and completion**

- New result variables take the first free `result_N`. Reuse node IDs have the form `reuse-<up to 69 characters of the rule ID>-<4 hex digits>` (at most 80 characters), and a Reuse card inserts once and shows *loading…*. Placeholders are `false` for BOOLEAN and `$OBJECT()` for OBJECT.
- Outline navigation is exact: case-sensitive, ignoring comments and strings. `@` Formula search waits for a 150 ms pause in typing, open suggestion lists refresh when the scope loads, and `/api/functions` is read once per page load.
- Unfinished nodes keep their gaps in code (`return;`, `when;`, `let total;`, `use "rule-id";`) instead of invented values such as `when true;`, and build errors point at the statement that caused them.

**Library, sources and playground**

- Catalog searches wait 250 ms after typing in the library, the sources list and the playground (the playground used 150 ms), and lists keep the previous rows while loading. A pending playground search disables the Rule selector. Saves no longer reload the hidden library or reset its page, and a paged list past its end moves to the last page.
- A Rule ID you typed survives name edits. Source IDs follow the Rule ID policy, and the HTTP timeout is a text field validated to 100–10,000 ms. The library tab "Conditions" is now "Condition rules". The playground and Test panel cURL examples show `{}` while the input is not a JSON object.

**Presentation**

- Programming ligatures are off on every code surface: canvas previews, JSON fields, code blocks and studio chips. Library preview node colors now match the canvas node colors, with one color token per node kind.
