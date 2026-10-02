import type { Definition } from "../../types";
import { stringifyJson } from "../../domain/json";

/**
 * A definition as the code view's JSON shows it: the form the server stores
 * and sends, every digit kept, indented by two spaces.
 */
export function definitionJson(definition: Definition): string {
  return stringifyJson(definition, 2);
}

/**
 * Where node `nodeId` is declared in `definitionJson` text: the start of its
 * "id" line inside "nodes", or null. Only node keys sit six spaces deep there;
 * an edge, a case or a field may carry the same ID deeper or elsewhere.
 */
export function nodeJsonOffset(text: string, nodeId: string): number | null {
  const nodes = text.indexOf('\n  "nodes": [\n');
  if (nodes < 0) return null;
  const end = text.indexOf("\n  ]", nodes);
  const key = `\n      "id": ${JSON.stringify(nodeId)}`;
  for (
    let at = text.indexOf(key, nodes);
    at >= 0 && at < end;
    at = text.indexOf(key, at + 1)
  ) {
    const next = text[at + key.length];
    if (next === "," || next === "\n") return at + 1;
  }
  return null;
}
