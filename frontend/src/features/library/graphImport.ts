import type { Definition } from "../../types";
import { isJsonObject, parseJson } from "../../domain/json";
import { counted } from "../../domain/text";

/** A chosen file read as a graph: the draft to create a rule with, or why it is not one. */
export type GraphFile =
  | { kind: "graph"; definition: Definition; summary: string }
  | { kind: "invalid"; problem: string };

/** Larger files are refused before they are read: an ARC draft is far smaller. */
export const maxGraphFileBytes = 5 * 1024 * 1024;

/** Whether `value` has a graph's shape; the server checks the rest when the rule is created. */
function isGraph(value: unknown): value is Definition {
  if (!isJsonObject(value) || !Array.isArray(value.nodes)) return false;
  return (
    (value.edges === undefined || Array.isArray(value.edges)) &&
    (value.inputs === undefined || Array.isArray(value.inputs))
  );
}

/**
 * The graph a file holds: Export definition writes it alone; a rule read from
 * the API holds it as `draft`, and a published version as `definition`.
 */
function graphIn(value: unknown): Definition | null {
  if (isGraph(value)) return value;
  if (!isJsonObject(value)) return null;
  if (isGraph(value.draft)) return value.draft;
  if (isGraph(value.definition)) return value.definition;
  return null;
}

/** Reads a file's text as a graph, keeping every digit of its numbers. */
export function readGraphFile(text: string): GraphFile {
  let value: unknown;
  try {
    value = parseJson(text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { kind: "invalid", problem: `This file is not JSON: ${reason}` };
  }
  const definition = graphIn(value);
  if (!definition)
    return {
      kind: "invalid",
      problem:
        "This file holds no ARC graph. Choose a file saved with Export definition.",
    };
  const summary = [
    counted(definition.nodes.length, "node"),
    counted(definition.inputs?.length ?? 0, "input"),
    counted(definition.edges?.length ?? 0, "connection"),
  ].join(" · ");
  return { kind: "graph", definition, summary };
}

/**
 * A rule name from an exported file's name: Export definition names files
 * `<rule ID>-v<version>.json` or `<rule ID>-draft.json`, so
 * "order-pricing-v3.json" suggests "Order pricing".
 */
export function suggestedImportName(fileName: string): string {
  const words = fileName
    .replace(/\.json$/i, "")
    .replace(/-(v\d+|draft)$/i, "")
    .replace(/[-_\s]+/g, " ")
    .trim();
  return words ? words[0].toUpperCase() + words.slice(1) : "";
}
