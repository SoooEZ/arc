import type { Definition, Input, Rule, Version } from "../../types";
import { quoteText } from "../../domain/expressions";
import { shortId } from "../../domain/ids";
import { MAX_NODE_ID_CHARACTERS } from "../../domain/limits";
import { placeholderLiteral } from "../../domain/placeholderLiterals";

/**
 * Monaco reads `$`, `}` and `\` in snippet text as tab-stop syntax. Escape ARC
 * code that must be inserted verbatim, e.g. `$ROUND(x)` becomes `\$ROUND(x)`.
 */
export function escapeSnippetText(code: string): string {
  return code.replace(/[$}\\]/g, "\\$&");
}

/** An ARC string literal for `text`, escaped for a Monaco snippet: quote first, then escape. */
export function snippetStringLiteral(text: string): string {
  return escapeSnippetText(quoteText(text));
}

// A rule ID alone may already use the whole node-ID limit.
const reusePrefix = "reuse-";
const reuseSuffixDigits = 4;

/** A Reference node ID that names the reused rule within the node-ID limit, e.g. "reuse-apply-discount-9f86". */
export function reuseNodeId(ruleId: string): string {
  const ruleIdLength =
    MAX_NODE_ID_CHARACTERS -
    reusePrefix.length -
    "-".length -
    reuseSuffixDigits;
  return shortId(
    `${reusePrefix}${ruleId.slice(0, ruleIdLength)}-`,
    reuseSuffixDigits,
  );
}

/**
 * Whether a call must pass a value for the input: it is required and has
 * neither a default nor a data source (the server's Input.needsCallerValue).
 * Reference snippets bind these, and Formula calls write them out.
 */
export function needsCallerValue(input: Input): boolean {
  return input.required && input.defaultValue == null && !input.source;
}

/**
 * The Reference node for a reused rule. `resultName` is the generated result
 * variable (`result_N`, unique among the caller's variables and the names the
 * unbuilt buffer declares, lesson F19); the tab stop lets the user rename it.
 */
export function referenceSnippet(
  rule: Pick<Rule, "id" | "name">,
  version: Version,
  caller: Definition,
  nodeId: string,
  resultName = "reusedResult",
): string {
  const callerInputs = new Set(caller.inputs.map((input) => input.name));
  const bindings = version.definition.inputs
    .filter(needsCallerValue)
    .map((input) => {
      const expression = callerInputs.has(input.name)
        ? input.name
        : placeholderLiteral[input.type];
      return `  bind ${input.name} = ${escapeSnippetText(expression)};`;
    });
  return [
    "",
    `node ${snippetStringLiteral(nodeId)} REFERENCE ${snippetStringLiteral(rule.name)} {`,
    `  use ${snippetStringLiteral(rule.id)} version ${version.version};`,
    ...bindings,
    `  as \${1:${escapeSnippetText(resultName)}};`,
    '  next -> "${2:output}";',
    "}",
    "",
  ].join("\n");
}

interface StudioModule {
  name: string;
  snippet: string;
  placement: "cursor" | "end";
}

export const modules: StudioModule[] = [
  {
    name: "Switch cases",
    placement: "end",
    snippet:
      '\nnode "${1:switch}" SWITCH "${2:Choose a branch}" {\n  case "premium" "Premium" when ${3:amount >= 100};\n  case "standard" "Standard" when ${4:amount >= 50};\n  case:premium -> "${5:premium}";\n  case:standard -> "${6:standard}";\n  default -> "${7:fallback}";\n}\n',
  },
  {
    name: "Switch values",
    placement: "end",
    snippet:
      '\nnode "${1:switch}" SWITCH "${2:Match a value}" {\n  select ${3:tier};\n  case "premium" "Premium" equals ${4:"premium"};\n  case "standard" "Standard" equals ${5:"standard"};\n  case:premium -> "${6:premium}";\n  case:standard -> "${7:standard}";\n  default -> "${8:fallback}";\n}\n',
  },
  {
    name: "Transform data",
    placement: "end",
    snippet:
      '\nnode "${1:transform}" TRANSFORM "${2:Normalize data}" {\n  field "${3:name}" = ${4:\\$UPPER(\\$TRIM(customer.name))};\n  field "${5:amount}" = ${6:\\$TO_NUMBER(customer.amount)};\n  as ${7:normalized};\n  next -> "${8:output}";\n}\n',
  },
  {
    name: "Formula",
    placement: "end",
    snippet:
      '\nnode "${1:calculate}" FORMULA "${2:Calculate}" {\n  let ${3:total} = ${4:\\$ROUND(amount * 1.2, 2)};\n  next -> "${5:output}";\n}\n',
  },
  {
    name: "Decision branch",
    placement: "end",
    snippet:
      '\nnode "${1:decision}" CONDITION "${2:Check eligibility}" {\n  when ${3:amount >= 100};\n  true -> "${4:approved}";\n  false -> "${5:declined}";\n}\n',
  },
  {
    name: "Output",
    placement: "end",
    snippet:
      '\nnode "${1:output}" OUTPUT "${2:Result}" {\n  return ${3:total};\n}\n',
  },
  {
    name: "Input declaration",
    placement: "cursor",
    snippet: "${1:amount}: ${2:NUMBER} required default ${3:100};",
  },
  {
    name: "External parameter",
    placement: "cursor",
    snippet:
      'source ${1:taxRate} = {"id":"${2:country-tax}","version":1,"bindings":{"key":"${3:country}"},"pointer":"/rate","onError":"FAIL"};',
  },
];
