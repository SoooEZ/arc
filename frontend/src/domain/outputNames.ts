import type { RuleNode } from "../types";
import { isIdentifier } from "./identifiers";
import { trimAsServer } from "./serverText";

/** Each reached Output contributes its raw value under this key in a multi-output result. */
export function multipleOutputFieldName(
  node: Pick<RuleNode, "id" | "expression" | "outputName">,
): string {
  if (node.outputName) return node.outputName;
  // Trimmed as GraphExecution trims it: a JavaScript trim also removed U+00A0
  // and U+3000, so the preview named a field the result does not have.
  const expression = trimAsServer(node.expression ?? "");
  return isIdentifier(expression) ? expression : node.id;
}
