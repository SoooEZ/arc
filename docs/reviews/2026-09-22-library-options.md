# Java library options — 2026-09-22

## Decision and evidence

Keep ARC's expression language and its published-version semantics. EvalEx is the strongest candidate for a future replacement experiment, but adopting its defaults would change existing results and validation. This pass should simplify ARC's parser/runtime boundaries and use existing Jackson support for string decoding, while retaining the POI and HTTP adapters.

This is a **static source and API assessment**, not a candidate-engine benchmark or compatibility test. Candidate libraries were not added to the project or executed. GitHub source, versions and licenses were read with `gh`; official project documentation supplied API context. Current dependency versions come from [the backend build](../../backend/pom.xml) and its Spring Boot 3.5.16 dependency management. The compatibility boundary is [the graph and expression contract](../architecture.md).

| Library | Version assessed / license | Fit for ARC |
| --- | --- | --- |
| EvalEx | [3.7.0 release](https://github.com/ezylang/EvalEx/releases/tag/3.7.0), [Apache-2.0](https://github.com/ezylang/EvalEx/blob/ac14b3bc7895547828b7cb62e0e4ec9fcff7762a/LICENSE) | BigDecimal, configurable MathContext, AST access, lazy function parameters and custom functions make it the closest candidate. Its defaults and dependency analysis do not preserve ARC's language. |
| Commons JEXL | [3.7.0 release](https://commons.apache.org/proper/commons-jexl/download_jexl.cgi), [Apache-2.0](https://github.com/apache/commons-jexl/blob/21827925ba6f4fff46ffe4c1f6c4fd41abc663a9/LICENSE.txt) | Mature general expression/script engine, with variables, arithmetic configuration and feature restrictions. Requires substantial type, grammar and execution-policy adaptation. |
| exp4j | [0.4.8 source](https://github.com/fasseg/exp4j/tree/b7a41d00ada678d198ef6d7eff4b7208e9375420), [Apache-2.0](https://github.com/fasseg/exp4j/blob/b7a41d00ada678d198ef6d7eff4b7208e9375420/LICENSE) | Its `setVariable(String, double)` / `double evaluate()` API cannot replace ARC's decimal, boolean, null and collection values. The [maintainer's README](https://github.com/fasseg/exp4j/blob/4657309f9cd95ca8b6e5e1ef855167d4f9d21d83/README.md) also says development is inactive. |
| Apache POI | Existing 5.5.1 dependency, [Apache-2.0](https://poi.apache.org/legal.html) | Already implements the Excel functions used by `ExcelFunctionAdapter`. Keep the explicit conversion from ARC decimals to Excel floating-point values. |
| Jackson | Existing BOM-managed 2.21.4, [Apache-2.0](https://github.com/FasterXML/jackson-core/blob/f17a4f7a7ffe895be367ce91afc6b06632643126/LICENSE) | Already handles JSONB, source JSON Pointer and script JSON fragments. Its configurable string parser can replace the handwritten escape decoder without another dependency. |
| Apache HttpClient | Existing BOM-managed 5.5.2, [Apache-2.0](https://github.com/apache/httpcomponents-client/blob/8a79eaa9ffb7e971d887cfe29e9ad3efa1068e91/LICENSE.txt) | Already supplies HTTP requests, custom DNS resolution and cancellation; HttpCore's `URIBuilder` encodes parameters. Keep ARC's destination, secret, body-size and total-deadline policies around it. |

These are permissive licenses, not an assertion that the application has no distribution obligations. Preserve applicable license and notice files when distributing dependencies. This assessment adds no dependency or license fee requirement and does not change the application's own license.

## Why EvalEx is not a drop-in replacement

The evidence below uses EvalEx 3.7.0 at commit `ac14b3bc7895547828b7cb62e0e4ec9fcff7762a`.

| Existing ARC behavior | Difference in EvalEx / migration work |
| --- | --- |
| `COALESCE(null, false, 1 / 0)` returns `false`; a non-null array is returned intact. | `CoalesceFunction` does not mark its arguments lazy and flattens array arguments. The evaluator computes eager arguments before calling the function. It would evaluate the failing fallback or return an array element. [Function](https://github.com/ezylang/EvalEx/blob/ac14b3bc7895547828b7cb62e0e4ec9fcff7762a/src/main/java/com/ezylang/evalex/functions/basic/CoalesceFunction.java#L27-L43), [evaluation](https://github.com/ezylang/EvalEx/blob/ac14b3bc7895547828b7cb62e0e4ec9fcff7762a/src/main/java/com/ezylang/evalex/Expression.java#L195-L214). |
| Conditions require actual booleans; `"1" + 2` is an error. | Numbers and strings can become boolean values, and `+` can concatenate text. ARC needs explicit operator/function adapters, not just a MathContext setting. [Data types](https://ezylang.github.io/EvalEx/concepts/datatypes.html), [addition](https://github.com/ezylang/EvalEx/blob/ac14b3bc7895547828b7cb62e0e4ec9fcff7762a/src/main/java/com/ezylang/evalex/operators/arithmetic/InfixPlusOperator.java). |
| `amount` and `Amount` are distinct; `MAP(items, item, item.price + factor)` depends on `items` and `factor`. | The default accessor and `getUsedVariables()` are case-insensitive. ARC's scoped collection syntax and local-variable exclusion would need additional parsing/analysis. [Dependency extraction](https://github.com/ezylang/EvalEx/blob/ac14b3bc7895547828b7cb62e0e4ec9fcff7762a/src/main/java/com/ezylang/evalex/Expression.java#L431-L449), [accessor configuration](https://ezylang.github.io/EvalEx/configuration/configuration.html). |
| A missing root variable is an error, but an absent object field evaluates to null. | Strict field access rejects missing fields; lenient mode also tolerates missing root variables. Neither default reproduces ARC's distinction. [Field access](https://github.com/ezylang/EvalEx/blob/ac14b3bc7895547828b7cb62e0e4ec9fcff7762a/src/main/java/com/ezylang/evalex/Expression.java#L236-L258). |
| Decimal literals retain their bounded precision; operations use DECIMAL128. Single quotes, explicit multiplication and ARC precedence are established syntax. | EvalEx defaults include 68-digit precision, trailing-zero stripping, implicit multiplication, different unary-minus/power precedence and disabled single quotes. Some are configurable, but numeric literals also use the configured MathContext. [Configuration](https://ezylang.github.io/EvalEx/configuration/configuration.html), [literal evaluation](https://github.com/ezylang/EvalEx/blob/ac14b3bc7895547828b7cb62e0e4ec9fcff7762a/src/main/java/com/ezylang/evalex/Expression.java#L128-L140). |

EvalEx's lazy-parameter mechanism does support selected-branch evaluation for `IF`; that is useful, but does not establish compatibility for every built-in. Its recursion and regular-expression limits also do not replace ARC's token, nesting, collection, numeric and operation limits. [Custom functions](https://ezylang.github.io/EvalEx/customization/custom_functions.html), [configuration](https://ezylang.github.io/EvalEx/configuration/configuration.html).

JEXL has `getVariables()` and configurable BigDecimal arithmetic, but its standard arithmetic coerces operands, including booleans and mixed numeric types. Its own documentation requires application-specific permissions for untrusted expressions; a default permission preset is not a complete sandbox. Using JEXL would still require ARC grammar restrictions, strict value operations and bounded evaluation. [Arithmetic API](https://commons.apache.org/proper/commons-jexl/apidocs/org/apache/commons/jexl3/JexlArithmetic.html), [permissions API](https://commons.apache.org/proper/commons-jexl/apidocs/org/apache/commons/jexl3/introspection/JexlPermissions.html).

## Focused reuse of existing packages

POI's function registry already supplies supported names and executable implementations. `FunctionCatalog` adds ARC-facing help and marks workbook-dependent functions reference-only. Replacing the whole language would not remove this adapter or the decimal/Excel distinction. [POI function API](https://poi.apache.org/apidocs/dev/org/apache/poi/ss/formula/eval/FunctionEval.html).

Jackson 2.21.4 offers a narrower, useful simplification for expression string literals:

- `ALLOW_SINGLE_QUOTES` preserves ARC's single-quoted literals.
- `ALLOW_BACKSLASH_ESCAPING_ANY_CHARACTER` preserves historical unknown escapes: `"a\q"` becomes `"aq"`.
- `ALLOW_UNESCAPED_CONTROL_CHARS` preserves raw line feeds and tabs already accepted inside ARC string tokens.

Enable those options only on the literal decoder's private parser factory/reader. Do not relax HTTP, source or persistence JSON parsing. Parse the existing Java `String`, require one string token and end-of-input, and preserve ARC's error translation. Jackson's `\u` branch still requires four hexadecimal digits even when unknown escapes are permitted; malformed Unicode must remain an ARC syntax error. Verify surrogate pairs, isolated UTF-16 surrogates, control characters, both quote styles, escaped delimiters and legacy unknown escapes against the current behavior before removing the decoder. [Feature definitions](https://github.com/FasterXML/jackson-core/blob/f17a4f7a7ffe895be367ce91afc6b06632643126/src/main/java/com/fasterxml/jackson/core/json/JsonReadFeature.java#L43-L90), [escape decoding](https://github.com/FasterXML/jackson-core/blob/f17a4f7a7ffe895be367ce91afc6b06632643126/src/main/java/com/fasterxml/jackson/core/json/ReaderBasedJsonParser.java#L2647-L2699), [unknown-escape handling](https://github.com/FasterXML/jackson-core/blob/f17a4f7a7ffe895be367ce91afc6b06632643126/src/main/java/com/fasterxml/jackson/core/base/ParserBase.java#L1378-L1390).

Keep the HTTP adapter's total deadline alongside connect/read timeouts: they constrain different failure modes. Keep DNS checks at resolution time, redirects/retries disabled, bounded response reads, and explicit missing/null/fallback behavior. A shorter HTTP wrapper that removes these is not an equivalent replacement. JSON Pointer already belongs to Jackson; ARC's dot-path object access has a different contract and should not be replaced incidentally.

## Admission criteria for an engine migration

1. Run a differential compatibility corpus covering saved and published definitions, operator precedence, decimal scale/rounding, strict types, null/missing fields, lazy failures, scoped collections and dependency extraction. Candidate source inspection alone is insufficient.
2. Preserve graph/ARC Script round trips, function metadata, static diagnostics without external reads, nested error locations and current HTTP failure contracts.
3. Exercise malicious/oversized inputs and repeated, concurrent and failed evaluations. Limits must remain explicit and isolated per evaluation, with no host calls, IO, clock or randomness exposed through a default function dictionary.
4. Demonstrate a net reduction in maintained code after including syntax adapters, strict operators, library configuration and error translation. Preserve existing extension points instead of introducing two parallel function catalogs.
5. Pin the selected version and inventory its transitive dependencies and notices. If any language behavior intentionally changes, introduce an explicit version/migration path that leaves already published rules reproducible.
