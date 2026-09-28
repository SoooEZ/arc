import type { Definition, RuleNode } from "../types";
import { decimalKey, isDecimalNumber, isJsonObject } from "./json";

/*
 * How a definition comes back from the server: a save response, a build echo
 * or a stored version lists every record field (unset ones as null) in
 * declaration order, respells numbers and may omit positions. These functions
 * tell such an echo from a real change and keep the local objects wherever
 * nothing changed, so identities derived from the draft survive (lesson F1).
 */

/**
 * Compares definitions the way the server stores them: object key order does
 * not matter and an explicit null equals an absent field. A save response
 * lists every record field (unset ones as null) in declaration order, so it
 * differs from the submitted draft only in these respects.
 */
export function sameDefinition(left: Definition, right: Definition): boolean {
  return left === right || canonicalJson(left) === canonicalJson(right);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  // A number is its value and decimal places however it is spelled: the server echoes
  // exponent notation in plain digits, which used to replace the local draft.
  if (isDecimalNumber(value)) return decimalKey(value.text) ?? value.text;
  if (typeof value === "number") {
    const token = JSON.stringify(value);
    return decimalKey(token) ?? token;
  }
  if (!isJsonObject(value)) return JSON.stringify(value) ?? "null";
  const fields: string[] = [];
  for (const key of Object.keys(value).sort())
    if (value[key] != null)
      fields.push(`${JSON.stringify(key)}:${canonicalJson(value[key])}`);
  return `{${fields.join(",")}}`;
}

const sameJson = (left: unknown, right: unknown) =>
  canonicalJson(left) === canonicalJson(right);

/**
 * Applies a node fragment build to the local draft, taking only what the
 * fragment owns, as the server's replaceNode does: the node, its outgoing
 * edges and, for an Input fragment, the parameters. Unchanged parts keep their
 * local objects (the build echo differs in key order, explicit nulls and edge
 * order), so an unchanged fragment returns `current` itself and the document
 * stays clean with its preview identity (lesson F1, F3).
 */
export function applyNodeFragment(
  current: Definition,
  nodeId: string,
  built: Definition,
): Definition {
  const localNode = current.nodes.find((node) => node.id === nodeId);
  const builtNode = built.nodes.find((node) => node.id === nodeId);
  if (!localNode || !builtNode) return built;
  const node = sameJson(localNode, builtNode) ? localNode : builtNode;
  const nodes =
    node === localNode
      ? current.nodes
      : current.nodes.map((candidate) =>
          candidate.id === nodeId ? node : candidate,
        );
  const edges = withOutgoingEdges(
    current.edges,
    nodeId,
    built.edges.filter((edge) => edge.source === nodeId),
  );
  const inputs =
    localNode.type === "INPUT" && !sameJson(current.inputs, built.inputs)
      ? built.inputs
      : current.inputs;
  if (
    nodes === current.nodes &&
    edges === current.edges &&
    inputs === current.inputs
  )
    return current;
  return { ...current, inputs, nodes, edges };
}

/**
 * The edges with `source`'s outgoing edges replaced by `outgoing`, in place of
 * the first one. The same set in any order keeps the local objects and order;
 * a changed set keeps each unchanged local edge object.
 */
function withOutgoingEdges(
  edges: Definition["edges"],
  source: string,
  outgoing: Definition["edges"],
): Definition["edges"] {
  const local = edges.filter((edge) => edge.source === source);
  const localByJson = new Map(local.map((edge) => [canonicalJson(edge), edge]));
  const unchanged =
    local.length === outgoing.length &&
    outgoing.every((edge) => localByJson.has(canonicalJson(edge)));
  if (unchanged) return edges;
  const replacement = outgoing.map(
    (edge) => localByJson.get(canonicalJson(edge)) ?? edge,
  );
  const result: Definition["edges"] = [];
  let inserted = false;
  for (const edge of edges) {
    if (edge.source !== source) {
      result.push(edge);
      continue;
    }
    if (!inserted) result.push(...replacement);
    inserted = true;
  }
  if (!inserted) result.push(...replacement);
  return result;
}

/**
 * Every node gets a numeric position when a draft enters the editor: API
 * clients may omit positions, which the server accepts, so a node without one
 * is placed at the origin, and coordinates that arrived as DecimalNumber
 * become numbers. The server writes its double coordinates as 400.0, which
 * the lossless codec keeps as a DecimalNumber; position arithmetic
 * (placement, focus, routing) needs plain numbers.
 */
export function withNodePositions(definition: Definition): Definition {
  if (definition.nodes.every((node) => hasNumericPosition(node)))
    return definition;
  return {
    ...definition,
    nodes: definition.nodes.map((node) =>
      hasNumericPosition(node)
        ? node
        : { ...node, position: numericPosition(node.position) },
    ),
  };
}

function hasNumericPosition(node: RuleNode): boolean {
  return (
    !!node.position &&
    typeof node.position.x === "number" &&
    typeof node.position.y === "number"
  );
}

function numericPosition(
  position: RuleNode["position"] | null | undefined,
): RuleNode["position"] {
  return { x: coordinate(position?.x), y: coordinate(position?.y) };
}

function coordinate(value: unknown): number {
  if (typeof value === "number") return value;
  if (isDecimalNumber(value)) return Number(value.text);
  return 0;
}
