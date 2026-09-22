import type { Definition, InputType, Rule, Version } from "../../types";

const bindingPlaceholder: Record<InputType, string> = {
  STRING: '"value"',
  BOOLEAN: "true",
  ARRAY: "[]",
  OBJECT: "null",
  NUMBER: "0",
};

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
    `node ${JSON.stringify(nodeId)} REFERENCE ${JSON.stringify(rule.name)} {`,
    `  use ${JSON.stringify(rule.id)} version ${version.version};`,
    ...bindings,
    "  as ${1:reusedResult};",
    '  next -> "${2:output}";',
    "}",
    "",
  ].join("\n");
}

export const modules = [
  {
    name: "Switch cases",
    snippet:
      '\nnode "${1:switch}" SWITCH "${2:Choose a branch}" {\n  case "premium" "Premium" when ${3:amount >= 100};\n  case "standard" "Standard" when ${4:amount >= 50};\n  case:premium -> "${5:premium}";\n  case:standard -> "${6:standard}";\n  default -> "${7:fallback}";\n}\n',
  },
  {
    name: "Transform data",
    snippet:
      '\nnode "${1:transform}" TRANSFORM "${2:Normalize data}" {\n  field "${3:name}" = ${4:UPPER(TRIM(customer.name))};\n  field "${5:amount}" = ${6:TO_NUMBER(customer.amount)};\n  as ${7:normalized};\n  next -> "${8:output}";\n}\n',
  },
  {
    name: "Formula",
    snippet:
      '\nnode "${1:calculate}" FORMULA "${2:Calculate}" {\n  let ${3:total} = ${4:ROUND(amount * 1.2, 2)};\n  next -> "${5:output}";\n}\n',
  },
  {
    name: "Decision branch",
    snippet:
      '\nnode "${1:decision}" CONDITION "${2:Check eligibility}" {\n  when ${3:amount >= 100};\n  true -> "${4:approved}";\n  false -> "${5:declined}";\n}\n',
  },
  {
    name: "Output",
    snippet:
      '\nnode "${1:output}" OUTPUT "${2:Result}" {\n  return ${3:total};\n}\n',
  },
  {
    name: "Input declaration",
    snippet: "${1:amount}: ${2:NUMBER} required default ${3:100};",
  },
  {
    name: "External parameter",
    snippet:
      'source ${1:taxRate} = {"id":"${2:country-tax}","version":1,"bindings":{"key":"${3:country}"},"pointer":"/rate","onError":"FAIL"};',
  },
];
