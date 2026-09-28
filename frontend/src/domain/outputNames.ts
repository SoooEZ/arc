import type { RuleNode } from "../types";
import { isIdentifier } from "./identifiers";

/** Each reached Output contributes its raw value under this key in a multi-output result. */
export function multipleOutputFieldName(
  node: Pick<RuleNode, "id" | "expression" | "outputName">,
): string {
  if (node.outputName) return node.outputName;
  const expression = node.expression?.trim() ?? "";
  return isIdentifier(expression) ? expression : node.id;
}
