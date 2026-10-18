import type { InputType } from "../../types";
import {
  isDecimalNumber,
  isJsonObject,
  parseJson,
  stringifyJson,
} from "../../domain/json";
import { identifierError } from "../../domain/identifiers";
import { inputTypes } from "../../domain/inputTypes";

/**
 * A source's parameters as table rows (SourceParametersEditor). The parameters
 * buffer stays the source of truth: the table reads it and writes the edited
 * list back whole, formatted as the buffer opened (`sourceBuffers`), so an
 * edit undone by hand leaves the source clean. A row keeps every field it was
 * read with, such as the `source: null` the server stores.
 */
export type ParameterRow = Record<string, unknown>;

export type ReadParameters =
  { rows: ParameterRow[]; error: null } | { rows: null; error: string };

/**
 * Source parameters are scalar (the server refuses ARRAY and OBJECT); the
 * table offers them in the order of a rule input's type menu.
 */
export const sourceParameterTypes: readonly InputType[] = inputTypes.filter(
  (type) => type !== "ARRAY" && type !== "OBJECT",
);

/** The parameters text as rows, or why it is not a list of parameters yet. */
export function readSourceParameters(text: string): ReadParameters {
  let parsed: unknown;
  try {
    parsed = parseJson(text);
  } catch (failure) {
    return { rows: null, error: (failure as Error).message };
  }
  if (!Array.isArray(parsed))
    return { rows: null, error: "The parameters must be one JSON array" };
  if (!parsed.every(isJsonObject))
    return { rows: null, error: "Every parameter must be a JSON object" };
  return { rows: parsed, error: null };
}

/** The parameters text the table writes, formatted like a loaded buffer. */
export function writeSourceParameters(rows: readonly ParameterRow[]): string {
  return stringifyJson(rows, 2);
}

/** A row's name as text, "" while it has none. */
export function parameterName(row: ParameterRow): string {
  return typeof row.name === "string" ? row.name : "";
}

/**
 * Whether the rows are a lookup table's one parameter, `key`: its name is
 * fixed, so only its type, its required flag and its default may change.
 */
export function isLookupKey(rows: readonly ParameterRow[]): boolean {
  return rows.length === 1 && rows[0].name === "key";
}

/** A required text parameter named `parameter`, `parameter2`, …, whichever is free. */
export function newParameterRow(rows: readonly ParameterRow[]): ParameterRow {
  const taken = new Set(rows.map(parameterName));
  let name = "parameter";
  for (let suffix = 2; taken.has(name); suffix++) name = `parameter${suffix}`;
  return { name, type: "STRING", required: true, defaultValue: null };
}

/** The row with another type; a default that no longer has that type is cleared. */
export function withParameterType(
  row: ParameterRow,
  type: InputType,
): ParameterRow {
  return defaultHasType(type, row.defaultValue)
    ? { ...row, type }
    : { ...row, type, defaultValue: null };
}

function defaultHasType(type: InputType, value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (type === "STRING") return typeof value === "string";
  if (type === "NUMBER")
    return typeof value === "number" || isDecimalNumber(value);
  if (type === "BOOLEAN") return typeof value === "boolean";
  return false;
}

/**
 * Why a row's name is marked in the table, or null: the identifier rule, or a
 * name another row already has (the server refuses both). The words of the
 * first problem of the whole list come from `sourceParameterBufferError`.
 */
export function parameterNameProblem(
  rows: readonly ParameterRow[],
  index: number,
): string | null {
  const name = rows[index].name;
  const invalid = identifierError(name);
  if (invalid) return invalid;
  const duplicate = rows.some(
    (other, at) => at !== index && other.name === name,
  );
  return duplicate ? `Another parameter is named ${name}` : null;
}
