import type { Definition, Input, NodeType, Rule, RuleNode } from "../types";
import { uniqueName } from "./ids";
import { stringifyJson } from "./json";
import { nodeKinds } from "./nodeKinds";
import { canAddEdge } from "./limits";
import { hasTargetPort, sourcePorts } from "./nodePorts";
import { variableNames } from "./variables";

/*
 * The graph as the editor changes it: semantic identities, locations, and the
 * pure mutations behind every graph command. Server echoes are reconciled in
 * `definitionEchoes.ts`; the variables an expression may read live in
 * `variables.ts`.
 */

export type DefinitionChange = (definition: Definition) => Definition;
export const ruleSnapshot = (
  rule: Pick<Rule, "name" | "description" | "draft">,
) => stringifyJson([rule.name, rule.description, rule.draft]);
/** Presentation-only dragging must not refetch semantic diagnostics or variables. */
export const semanticGraphKey = (definition: Definition) =>
  stringifyJson({
    ...definition,
    nodes: definition.nodes.map(({ position: _position, ...node }) => node),
  });

/**
 * What the server's scope analysis reads (BranchScopes and the graph
 * topology): input names, each node's ID, kind, stored result name and a
 * Switch's case IDs, and every connection. Labels, expressions, defaults and
 * positions are not part of it, so editing them keeps the variables in scope
 * and sends no read (lesson F10 still applies to a pending read).
 */
export function scopeGraphKey(definition: Definition): string {
  const nodes = definition.nodes.map((node) => [
    node.id,
    node.type,
    nodeKinds[node.type].storesResult ? (node.output ?? null) : null,
    node.type === "SWITCH" ? (node.cases ?? []).map((c) => c.id) : null,
  ]);
  const edges = definition.edges.map((edge) => [
    edge.source,
    edge.sourceHandle,
    edge.target,
  ]);
  return JSON.stringify([
    definition.inputs.map((input) => input.name),
    nodes,
    edges,
  ]);
}

/** The rule version an error location, diagnostic or trace step belongs to. */
export interface GraphLocation {
  ruleId: string | null;
  version: number | null;
}
/**
 * Preview reports its root graph as rule "preview" without a version. A
 * published rule may also have the ID "preview", but its locations always
 * carry a version.
 */
export function isPreviewRoot(location: GraphLocation): boolean {
  return location.ruleId === "preview" && location.version === null;
}
/**
 * Whether a location belongs to the graph an editor shows: static diagnostics
 * name no rule, preview reports its root with the sentinel, and problems
 * carried into a referenced-rule viewer name that rule and version. Any other
 * location, including this rule's own published version called through a
 * Reference, belongs to a referenced graph.
 */
export function isCurrentGraphLocation(
  location: GraphLocation,
  shown: { ruleId: string; version: number | null },
): boolean {
  if (!location.ruleId || isPreviewRoot(location)) return true;
  return location.ruleId === shown.ruleId && location.version === shown.version;
}
export function patchGraphNode(
  definition: Definition,
  id: string,
  patch: Partial<RuleNode>,
): Definition {
  const updated = definition.nodes.find((node) => node.id === id);
  const validHandles =
    updated && patch.cases
      ? new Set(sourcePorts({ ...updated, ...patch }).map((port) => port.id))
      : null;
  return {
    ...definition,
    nodes: definition.nodes.map((node) =>
      node.id === id ? { ...node, ...patch } : node,
    ),
    edges: validHandles
      ? definition.edges.filter(
          (edge) => edge.source !== id || validHandles.has(edge.sourceHandle),
        )
      : definition.edges,
  };
}
/**
 * The graph's entry Input stays: the first Input in document order, as the
 * server's Definition.inputNode reads it. An extra Input can go, since the
 * graph is invalid until it does. Every draft keeps at least one node,
 * including drafts without an Input.
 */
export function canRemoveGraphNode(
  definition: Definition,
  id: string,
): boolean {
  const node = definition.nodes.find((candidate) => candidate.id === id);
  if (!node || definition.nodes.length <= 1) return false;
  const removable = nodeKinds[node.type].removable;
  if (removable === "extra") {
    const first = definition.nodes.find(
      (candidate) => candidate.type === node.type,
    );
    return first?.id !== id;
  }
  return removable;
}
export function removeGraphNode(
  definition: Definition,
  id: string,
): Definition {
  if (!canRemoveGraphNode(definition, id)) return definition;
  return {
    ...definition,
    nodes: definition.nodes.filter((node) => node.id !== id),
    edges: definition.edges.filter(
      (edge) => edge.source !== id && edge.target !== id,
    ),
  };
}
/** The ends a connection gesture names; React Flow leaves a missing end null. */
export interface ConnectionEnds {
  source: string | null;
  target: string | null;
  sourceHandle?: string | null;
}
/**
 * Whether the draft takes this connection: known nodes with the right ports,
 * not a loop, not a duplicate, and within the connection limit. The canvas
 * asks while the handle is dragged, so a refused drop is shown as refused.
 */
export function connectionAllowed(
  definition: Definition,
  { source, target, sourceHandle }: ConnectionEnds,
): boolean {
  if (!source || !target || !sourceHandle) return false;
  return (
    connectGraphNodes(definition, source, target, sourceHandle, "probe") !==
    definition
  );
}
export function connectGraphNodes(
  definition: Definition,
  source: string,
  target: string,
  sourceHandle: string,
  edgeId: string,
): Definition {
  const sourceNode = definition.nodes.find((node) => node.id === source);
  const targetNode = definition.nodes.find((node) => node.id === target);
  if (
    source === target ||
    !sourceNode ||
    !targetNode ||
    !hasTargetPort(targetNode) ||
    !sourcePorts(sourceNode).some((port) => port.id === sourceHandle)
  )
    return definition;
  if (
    !canAddEdge(definition) ||
    definition.edges.some(
      (edge) =>
        edge.source === source &&
        edge.target === target &&
        edge.sourceHandle === sourceHandle,
    )
  )
    return definition;
  return {
    ...definition,
    edges: [...definition.edges, { id: edgeId, source, target, sourceHandle }],
  };
}
/**
 * A new required NUMBER parameter named input<N>, unique among inputs and node
 * results (lesson F19): a parameter named like a result made that node fail
 * with "cannot overwrite input".
 */
export function newInputParameter(definition: Definition): Input {
  return {
    name: uniqueName(
      "input",
      variableNames(definition),
      definition.inputs.length + 1,
    ),
    type: "NUMBER",
    required: true,
    defaultValue: null,
  };
}
export function createGraphNode(
  definition: Definition,
  type: NodeType,
  id: string,
  position: RuleNode["position"],
): RuleNode {
  const kind = nodeKinds[type];
  const fields = kind.newNodeFields();
  return {
    id,
    type,
    position,
    label: kind.newNodeLabel,
    expression: fields.expression,
    // A reused name would make two nodes write the same variable.
    output: kind.storesResult
      ? uniqueName("result_", variableNames(definition))
      : undefined,
    bindings: fields.bindings,
    cases: fields.cases,
    fields: fields.fields,
  };
}
