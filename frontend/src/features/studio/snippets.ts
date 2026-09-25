import type { Definition, InputType, Rule, Version } from "../../types";

const bindingPlaceholder: Record<InputType, string> = {
  STRING: '"value"',
  BOOLEAN: "true",
  ARRAY: "[]",
  OBJECT: "null",
  NUMBER: "0",
};

/** Escape data after ARC quoting; Monaco interprets snippets before ARC parses them. */
function snippetLiteral(value: string): string {
  return JSON.stringify(value).replace(/[$}\\]/g, "\\$&");
}

export function referenceSnippet(
  rule: Pick<Rule, "id" | "name">,
  version: Version,
  caller: Definition,
  nodeId: string,
): string {
  const bindings = version.definition.inputs
    .filter(
      (input) => input.required && !input.source && input.defaultValue == null,
    )
    .map((input) => {
      const expression = caller.inputs.some(
        (candidate) => candidate.name === input.name,
      )
        ? input.name
        : bindingPlaceholder[input.type];
      return `  bind ${input.name} = ${expression};`;
    });
  return [
    "",
    `node ${snippetLiteral(nodeId)} REFERENCE ${snippetLiteral(rule.name)} {`,
    `  use ${snippetLiteral(rule.id)} version ${version.version};`,
    ...bindings,
    "  as ${1:reusedResult};",
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
      '\nnode "${1:transform}" TRANSFORM "${2:Normalize data}" {\n  field "${3:name}" = ${4:UPPER(TRIM(customer.name))};\n  field "${5:amount}" = ${6:TO_NUMBER(customer.amount)};\n  as ${7:normalized};\n  next -> "${8:output}";\n}\n',
  },
  {
    name: "Formula",
    placement: "end",
    snippet:
      '\nnode "${1:calculate}" FORMULA "${2:Calculate}" {\n  let ${3:total} = ${4:ROUND(amount * 1.2, 2)};\n  next -> "${5:output}";\n}\n',
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
