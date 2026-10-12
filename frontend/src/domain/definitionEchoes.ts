import type { Definition, Input, RuleNode } from "../types";
import { decimalKey, isDecimalNumber, isJsonObject } from "./json";
import { nodeKinds } from "./nodeKinds";

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

/**
 * `inValue` is true below an input's defaultValue: the server echoes a
 * record's unset field as null, but a null inside a value is part of it, so
 * {"a": null} and {} are different defaults. An empty list or map of a record
 * field is unset as well: a Transform saved with `fields: []` comes back from
 * a node build as `fields: null`, a Switch's `cases: null` as `[]` and a
 * Reference's `bindings: null` as `{}`, and both spellings evaluate alike. A
 * default of `[]` or `{}` is a value, so it never equals no default.
 */
function canonicalJson(value: unknown, inValue = false): string {
  if (Array.isArray(value))
    return `[${value.map((item) => canonicalJson(item, inValue)).join(",")}]`;
  // A number is its value and decimal places however it is spelled: the server echoes
  // exponent notation in plain digits, which used to replace the local draft.
  if (isDecimalNumber(value)) return decimalKey(value.text) ?? value.text;
  if (typeof value === "number") {
    const token = JSON.stringify(value);
    return decimalKey(token) ?? token;
  }
  if (!isJsonObject(value)) return JSON.stringify(value) ?? "null";
  const fields: string[] = [];
  for (const key of Object.keys(value).sort()) {
    const field = value[key];
    const valueBelow = inValue || key === "defaultValue";
    if (field === undefined || (field === null && !inValue)) continue;
    if (!valueBelow && isEmptyCollection(field)) continue;
    const json = canonicalJson(field, valueBelow);
    fields.push(`${JSON.stringify(key)}:${json}`);
  }
  return `{${fields.join(",")}}`;
}

function isEmptyCollection(value: unknown): boolean {
  if (Array.isArray(value)) return value.length === 0;
  return isJsonObject(value) && Object.keys(value).length === 0;
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
    nodeKinds[localNode.type].ownsInputs &&
    !sameJson(current.inputs, built.inputs)
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
 * A draft as the editor holds it: every node has a numeric position and every
 * source binding a pointer string. Every draft passes here on its way into
 * the editor (open, version load, build, node fragment, adopted save
 * response); one that needs nothing comes back as the same object, so the
 * echo of an unchanged draft still compares equal to the local draft.
 */
export function editableDraft(definition: Definition): Definition {
  return withSourcePointers(withNodePositions(definition));
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

/**
 * API clients and `source` statements may omit a binding's pointer, which the
 * server stores and echoes as null. The pointer field is a controlled text
 * input, and null and "" both read the whole result, so the editor holds "".
 */
function withSourcePointers(definition: Definition): Definition {
  const unset = (input: Input) =>
    input.source != null && input.source.pointer == null;
  if (!definition.inputs.some(unset)) return definition;
  return {
    ...definition,
    inputs: definition.inputs.map((input) =>
      unset(input) && input.source
        ? { ...input, source: { ...input.source, pointer: "" } }
        : input,
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
