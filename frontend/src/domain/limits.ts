import type { Definition } from "../types";
import { isBlankAsServer, trimAsServer } from "./serverText";

/**
 * Server limits restated for the browser (backend `engine.Limits`), so that
 * fields and commands refuse what the server would reject before a save or a
 * preview does. Each constant carries its Java name; the mirror check
 * (scripts/check_mirrors.test.mjs) fails when a value drifts from Limits.java.
 */

/** Input parameters a definition may declare. */
export const MAX_INPUTS = 50;
/** Nodes a definition may hold. */
export const MAX_NODES = 100;
/** Connections a definition may hold. */
export const MAX_EDGES = 200;
/** Cases of one Switch. */
export const MAX_SWITCH_CASES = 20;
/** Fields of one Transform. */
export const MAX_TRANSFORM_FIELDS = 50;
/** UTF-16 units of a node label or Switch case label. */
export const MAX_LABEL_CHARACTERS = 160;
/** UTF-16 units of a rule or source name. */
export const MAX_NAME_CHARACTERS = 160;
/** UTF-16 units of a rule description. */
export const MAX_DESCRIPTION_CHARACTERS = 2_000;
/** Characters of a parameter, result or field identifier. */
export const MAX_IDENTIFIER_CHARACTERS = 64;
/** Characters of a rule or source ID (the API slug). */
export const MAX_RESOURCE_ID_CHARACTERS = 80;
/** Characters of a node ID. */
export const MAX_NODE_ID_CHARACTERS = 80;
/** ExpressionParser reads at most this many tokens from one expression. */
export const MAX_EXPRESSION_TOKENS = 256;
/** UTF-16 units of one text value (ValueBounds). */
export const MAX_STRING_CHARACTERS = 2_000;
/** Items of one array, or fields of one object (ValueBounds). */
export const MAX_COLLECTION_ITEMS = 1_000;
/** Values a whole default, input or result may hold, keys included (ValueBounds). */
export const MAX_VALUE_ELEMENTS = 10_000;
/** How deep a value may nest below its root (ValueBounds). */
export const MAX_VALUE_DEPTH = 8;
/** Significant digits a number may carry. */
export const MAX_NUMBER_PRECISION = 100;
/** Decimal places a number may carry, either way. */
export const MAX_NUMBER_SCALE = 100;

/** Whether one more node fits the draft. */
export function canAddNode(definition: Pick<Definition, "nodes">): boolean {
  return definition.nodes.length < MAX_NODES;
}

/** Whether one more connection fits the draft. */
export function canAddEdge(definition: Pick<Definition, "edges">): boolean {
  return definition.edges.length < MAX_EDGES;
}

/** Whether one more input parameter fits the draft. */
export function canAddInput(definition: Pick<Definition, "inputs">): boolean {
  return definition.inputs.length < MAX_INPUTS;
}

/** Grouped digits, as the server writes limits in its messages ("2,000"). */
export function formatLimit(limit: number): string {
  return limit.toLocaleString("en-US");
}

/** The server's refusal of a rule's name or description, and which field it belongs to. */
export interface RuleMetadataProblem {
  field: "name" | "description";
  message: string;
}

/**
 * Why the server would refuse a rule's name and description, or null: the
 * messages are the server's, so a dialog can show them under the field and
 * refuse before sending. The name is trimmed as the server trims it.
 */
export function ruleMetadataProblem({
  name,
  description,
}: {
  name: string;
  description: string;
}): RuleMetadataProblem | null {
  const trimmed = trimAsServer(name);
  if (isBlankAsServer(trimmed) || trimmed.length > MAX_NAME_CHARACTERS)
    return {
      field: "name",
      message: `Rule name must contain 1 to ${MAX_NAME_CHARACTERS} characters`,
    };
  if (description.length > MAX_DESCRIPTION_CHARACTERS)
    return {
      field: "description",
      message: `Description exceeds ${formatLimit(MAX_DESCRIPTION_CHARACTERS)} characters`,
    };
  return null;
}
