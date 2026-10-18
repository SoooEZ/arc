import { isJsonObject, parseJson, stringifyJson } from "../../domain/json";

/**
 * A lookup source's entries as a table: a row per key, and a column per field
 * when every entry is a record ({"DE": {"rate": 0.19}} reads as a "rate"
 * column, which a binding's JSON pointer /rate selects), or one value column
 * otherwise (pointer ""). The entries buffer stays the source of truth; the
 * table only reads it and writes the edited object back.
 */
export interface LookupTable {
  /** The record fields in first-seen order, or null for one value column. */
  fields: string[] | null;
  rows: LookupRow[];
}

export interface LookupRow {
  key: string;
  value: unknown;
}

export type ReadTable =
  { table: LookupTable; error: null } | { table: null; error: string };

/** The entries text as a table, or why it is not a JSON object yet. */
export function readLookupTable(entries: string): ReadTable {
  let parsed: unknown;
  try {
    parsed = parseJson(entries.trim() ? entries : "{}");
  } catch (failure) {
    return { table: null, error: (failure as Error).message };
  }
  if (!isJsonObject(parsed))
    return { table: null, error: "The entries must be one JSON object" };
  const rows = Object.entries(parsed).map(([key, value]) => ({ key, value }));
  if (!rows.length || !rows.every(({ value }) => isJsonObject(value)))
    return { table: { fields: rows.length ? null : [], rows }, error: null };
  const fields: string[] = [];
  const seen = new Set<string>();
  for (const { value } of rows)
    for (const field of Object.keys(value as object))
      if (!seen.has(field)) {
        seen.add(field);
        fields.push(field);
      }
  return { table: { fields, rows }, error: null };
}

/** The entries text a table writes, formatted like the JSON view writes it. */
export function lookupEntries(rows: readonly LookupRow[]): string {
  const entries: Record<string, unknown> = {};
  for (const { key, value } of rows) entries[key] = value;
  return stringifyJson(entries, 2);
}

/**
 * A cell's text: text as typed, other values as JSON. Text that would read
 * back as another value ("12", "true", "[1]") keeps its quotes, so a cell
 * always reads back as the value it shows.
 */
export function cellText(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value === "string" && readsAsText(value)) return value;
  return stringifyJson(value);
}

/**
 * What typed cell text stands for: a number, true, false, null, an array, a
 * record or quoted text when it is valid JSON, otherwise the text itself.
 * Numbers keep every digit (domain/json).
 */
export function cellValue(text: string): unknown {
  return readsAsText(text) ? text : parseJson(text);
}

function readsAsText(text: string): boolean {
  try {
    parseJson(text);
    return false;
  } catch {
    // Not JSON, so the text is a string value as typed.
    return true;
  }
}
