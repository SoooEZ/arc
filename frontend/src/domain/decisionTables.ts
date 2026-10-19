// A decision table node's table as the editor reads and edits it. The test
// cell grammar mirrors the server's (docs/architecture.md, "Decision tables");
// the server stays the judge of a published table, this module lets the grid
// mark a cell while the user types and keeps edits within the server's limits.

import type {
  Definition,
  DecisionTable,
  DecisionTableRow,
  HitPolicy,
} from "../types";
import {
  isArrayLiteral,
  isNumberLiteral,
  literalText,
  quoteText,
} from "./expressions";
import { identifierError } from "./identifiers";
import { uniqueName } from "./ids";
import { decimalTextParts } from "./json";
import {
  MAX_LABEL_CHARACTERS,
  MAX_TABLE_CONDITIONS,
  MAX_TABLE_RESULTS,
  MAX_TABLE_ROWS,
} from "./limits";
import { unsupportedNumber, withinServerLimits } from "./numericDefaults";
import { counted } from "./text";

/** A literal a test compares with. Numbers keep their text: 1 and 1.0 are one value. */
export type CellLiteral =
  | { type: "number"; text: string }
  | { type: "string"; value: string }
  | { type: "boolean"; value: boolean }
  | { type: "null" };

export type ComparisonOperator = "<" | "<=" | ">" | ">=";

export type CellTest =
  | { kind: "equals"; literal: CellLiteral }
  | { kind: "notEquals"; literal: CellLiteral }
  | { kind: "compare"; operator: ComparisonOperator; number: string }
  | {
      kind: "range";
      low: string;
      high: string;
      lowIncluded: boolean;
      highIncluded: boolean;
    };

/** `-` holds for every value; a list holds when one of its tests does, `not(…)` when none does. */
export type ParsedCell =
  { kind: "any" } | { kind: "tests"; negated: boolean; tests: CellTest[] };

export type CellParse =
  { ok: true; cell: ParsedCell } | { ok: false; problem: string };

export const testGuidance =
  'Write a value ("gold", 100, true, null), a comparison (>= 100, != "x"), a range (100..<500), a list ("a", "b"), not(…) or - for any value.';

type Symbol =
  | "("
  | ")"
  | ","
  | "!="
  | "<="
  | ">="
  | "<"
  | ">"
  | ".."
  | "..<"
  | "<.."
  | "<..<"
  | "-"
  | "=";

type Token =
  | { kind: "string"; value: string }
  | { kind: "number"; text: string }
  | { kind: "word"; text: string }
  | { kind: "symbol"; text: Symbol };

/** Longest first, so `<..<` is not read as `<` and `..<` as `..`. */
const symbols: readonly Symbol[] = [
  "<..<",
  "<..",
  "..<",
  "..",
  "<=",
  ">=",
  "!=",
  "<",
  ">",
  "(",
  ")",
  ",",
  "=",
];
// The server's number token, with a directly attached minus sign.
const numberToken = /-?(?:\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\.\d+)/y;
const wordToken = /[A-Za-z_][A-Za-z_0-9]*/y;
const lineTerminators = "\n\r\u0085  ";

class CellSyntaxError extends Error {}

function isBlank(character: string): boolean {
  return character <= " ";
}

/** The tokens of a cell; a string literal is scanned by a loop, never a recursive pattern. */
function scan(text: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < text.length) {
    const character = text[index];
    if (isBlank(character)) {
      index++;
      continue;
    }
    if (character === '"' || character === "'") {
      let end = index + 1;
      while (end < text.length && text[end] !== character) {
        if (text[end] === "\\") {
          if (end + 1 >= text.length || lineTerminators.includes(text[end + 1]))
            throw new CellSyntaxError("Close the quote.");
          end++;
        } else if (lineTerminators.includes(text[end]))
          throw new CellSyntaxError("Close the quote.");
        end++;
      }
      if (end >= text.length) throw new CellSyntaxError("Close the quote.");
      const value = literalText(text.slice(index, end + 1));
      if (value === null) throw new CellSyntaxError(testGuidance);
      tokens.push({ kind: "string", value });
      index = end + 1;
      continue;
    }
    numberToken.lastIndex = index;
    const number = numberToken.exec(text);
    if (number) {
      tokens.push({ kind: "number", text: number[0] });
      index = numberToken.lastIndex;
      continue;
    }
    wordToken.lastIndex = index;
    const word = wordToken.exec(text);
    if (word) {
      tokens.push({ kind: "word", text: word[0] });
      index = wordToken.lastIndex;
      continue;
    }
    const symbol =
      character === "-"
        ? "-"
        : symbols.find((candidate) => text.startsWith(candidate, index));
    if (!symbol) throw new CellSyntaxError(testGuidance);
    tokens.push({ kind: "symbol", text: symbol });
    index += symbol.length;
  }
  return tokens;
}

function isSymbol(token: Token | undefined, text: Symbol): boolean {
  return token?.kind === "symbol" && token.text === text;
}

function literalOf(token: Token): CellLiteral | null {
  if (token.kind === "string") return { type: "string", value: token.value };
  if (token.kind === "number") return { type: "number", text: token.text };
  if (token.kind === "word") {
    if (token.text === "true") return { type: "boolean", value: true };
    if (token.text === "false") return { type: "boolean", value: false };
    if (token.text === "null") return { type: "null" };
  }
  return null;
}

function checkedNumber(text: string): string {
  if (!withinServerLimits(text)) throw new CellSyntaxError(unsupportedNumber);
  return text;
}

const rangeOperators: Record<string, [boolean, boolean]> = {
  "..": [true, true],
  "..<": [true, false],
  "<..": [false, true],
  "<..<": [false, false],
};

function parseTest(tokens: Token[]): CellTest {
  const [first, second, third] = tokens;
  if (tokens.length === 1) {
    if (isSymbol(first, "-"))
      throw new CellSyntaxError("- stands alone: it matches any value.");
    const literal = literalOf(first);
    if (literal) {
      if (literal.type === "number") checkedNumber(literal.text);
      return { kind: "equals", literal };
    }
  }
  if (tokens.length === 2 && isSymbol(first, "!=")) {
    const literal = literalOf(second);
    if (literal) {
      if (literal.type === "number") checkedNumber(literal.text);
      return { kind: "notEquals", literal };
    }
  }
  if (
    tokens.length === 2 &&
    first.kind === "symbol" &&
    ["<", "<=", ">", ">="].includes(first.text)
  ) {
    if (second.kind !== "number")
      throw new CellSyntaxError("Comparisons and ranges take numbers.");
    return {
      kind: "compare",
      operator: first.text as ComparisonOperator,
      number: checkedNumber(second.text),
    };
  }
  if (
    tokens.length === 3 &&
    second.kind === "symbol" &&
    Object.hasOwn(rangeOperators, second.text)
  ) {
    if (first.kind !== "number" || third.kind !== "number")
      throw new CellSyntaxError("Comparisons and ranges take numbers.");
    const [lowIncluded, highIncluded] = rangeOperators[second.text];
    const low = checkedNumber(first.text);
    const high = checkedNumber(third.text);
    const order = compareDecimals(low, high);
    if (order > 0 || (order === 0 && !(lowIncluded && highIncluded)))
      throw new CellSyntaxError(
        "This range holds no value: write the lower bound first.",
      );
    return { kind: "range", low, high, lowIncluded, highIncluded };
  }
  if (isSymbol(first, "="))
    throw new CellSyntaxError('Write the value alone: "gold", not = "gold".');
  if (tokens.some((token) => token.kind === "word" && !literalOf(token)))
    throw new CellSyntaxError(`Put text in quotes. ${testGuidance}`);
  throw new CellSyntaxError(testGuidance);
}

/** Splits tokens at top-level commas. */
function commaSeparated(tokens: Token[]): Token[][] {
  const parts: Token[][] = [[]];
  for (const token of tokens) {
    if (isSymbol(token, ",")) parts.push([]);
    else parts[parts.length - 1].push(token);
  }
  return parts;
}

/** Reads a test cell, or says what is wrong with it. */
export function parseTestCell(text: string): CellParse {
  try {
    const tokens = scan(text);
    if (!tokens.length)
      return { ok: false, problem: "Enter a test, or - for any value." };
    if (tokens.length === 1 && isSymbol(tokens[0], "-"))
      return { ok: true, cell: { kind: "any" } };
    let inner = tokens;
    let negated = false;
    if (tokens[0].kind === "word" && tokens[0].text === "not") {
      if (!isSymbol(tokens[1], "(") || !isSymbol(tokens.at(-1), ")"))
        throw new CellSyntaxError(
          "Write not( … ) around the values it excludes.",
        );
      inner = tokens.slice(2, -1);
      negated = true;
    }
    if (inner.some((token) => isSymbol(token, "(") || isSymbol(token, ")")))
      throw new CellSyntaxError(testGuidance);
    const parts = commaSeparated(inner);
    if (parts.some((part) => !part.length))
      throw new CellSyntaxError(testGuidance);
    return {
      ok: true,
      cell: { kind: "tests", negated, tests: parts.map(parseTest) },
    };
  } catch (error) {
    if (error instanceof CellSyntaxError)
      return { ok: false, problem: error.message };
    throw error;
  }
}

function decimalValue(text: string): { coefficient: bigint; power: bigint } {
  const parts = decimalTextParts(text);
  if (!parts) throw new RangeError(`${text} is not a number`);
  const digits = (parts.integer + parts.fraction).replace(/^0+/, "");
  const magnitude = BigInt(digits || "0");
  return {
    coefficient: parts.negative ? -magnitude : magnitude,
    power: parts.exponent - BigInt(parts.fraction.length),
  };
}

/** Orders two number literals by value: 1 and 1.0 are equal, -5 is below .5. */
export function compareDecimals(left: string, right: string): number {
  const a = decimalValue(left);
  const b = decimalValue(right);
  const power = a.power < b.power ? a.power : b.power;
  const scaledA = a.coefficient * 10n ** (a.power - power);
  const scaledB = b.coefficient * 10n ** (b.power - power);
  if (scaledA === scaledB) return 0;
  return scaledA < scaledB ? -1 : 1;
}

/** The type of value a literal tests; null tests any column. */
export function literalType(
  literal: CellLiteral,
): "number" | "string" | "boolean" | null {
  return literal.type === "null" ? null : literal.type;
}

function cellLiterals(cell: ParsedCell): CellLiteral[] {
  if (cell.kind === "any") return [];
  return cell.tests.flatMap((test): CellLiteral[] => {
    if (test.kind === "equals" || test.kind === "notEquals")
      return [test.literal];
    return [
      {
        type: "number",
        text: test.kind === "compare" ? test.number : test.low,
      },
    ];
  });
}

const typeNames = { number: "a number", string: "text", boolean: "true/false" };

/**
 * What is wrong with each test cell of `rows`, whose tables have
 * `conditionCount` condition columns: its syntax, or a literal of another
 * type than the column's first one (a column compares one type of value).
 */
export function testCellProblems(
  rows: readonly DecisionTableRow[],
  conditionCount: number,
): (string | null)[][] {
  const columns = Array.from({ length: conditionCount }, (_, index) => index);
  const columnType: ("number" | "string" | "boolean" | null)[] = columns.map(
    () => null,
  );
  const firstRow: number[] = columns.map(() => 0);
  return rows.map((row, rowIndex) =>
    columns.map((column) => {
      const parsed = parseTestCell(row.when[column] ?? "");
      if (!parsed.ok) return parsed.problem;
      for (const literal of cellLiterals(parsed.cell)) {
        const type = literalType(literal);
        if (!type) continue;
        const known = columnType[column];
        if (!known) {
          columnType[column] = type;
          firstRow[column] = rowIndex + 1;
        } else if (known !== type)
          return `This column tests ${typeNames[known]} (row ${firstRow[column]}); a column tests one type of value.`;
      }
      return null;
    }),
  );
}

/** Whether every test cell of the table reads as a test of its column's type. */
export function testsAreValid(table: DecisionTable): boolean {
  return testCellProblems(table.rows, table.conditions.length).every((row) =>
    row.every((cell) => !cell),
  );
}

/** Splits text at commas outside quotes. */
function splitOutsideQuotes(text: string): string[] {
  const parts: string[] = [];
  let quote: string | null = null;
  let start = 0;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (quote) {
      if (character === "\\") index++;
      else if (character === quote) quote = null;
    } else if (character === '"' || character === "'") quote = character;
    else if (character === ",") {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

/** Text that a test can only mean as a string: no quotes, no operator, not a number. */
function isBareText(text: string): boolean {
  return text !== "" && !/["']/.test(text) && !/^[<>!=(\-.\d]/.test(text);
}

function committedItem(item: string): string {
  const text = item.trim();
  if (/^(true|false|null)$/i.test(text)) return text.toLowerCase();
  return isBareText(text) ? quoteText(text) : text;
}

/**
 * A test cell as the grid stores it once the user leaves it: trimmed, with
 * bare text quoted (`gold` → `"gold"`, `gold, silver` → `"gold", "silver"`,
 * `not(gold)` → `not("gold")`) and TRUE/FALSE/NULL in lower case. Text that
 * still is no test stays as typed, marked by its problem.
 */
export function committedTestCell(text: string): string {
  const trimmed = text.trim();
  if (trimmed === "" || parseTestCell(trimmed).ok) return trimmed;
  const not = /^not\s*\(([\s\S]*)\)$/.exec(trimmed);
  const inner = not ? not[1] : trimmed;
  const items = splitOutsideQuotes(inner).map(committedItem).join(", ");
  const candidate = not ? `not(${items})` : items;
  return parseTestCell(candidate).ok ? candidate : trimmed;
}

/** A spreadsheet cell pasted into a condition column: empty is any value. */
export function pastedTestCell(text: string): string {
  const trimmed = text.trim();
  return trimmed === "" ? "-" : committedTestCell(trimmed);
}

/**
 * A spreadsheet cell pasted into a result column, read as a value: numbers
 * and quoted text stay, TRUE/FALSE/NULL become true/false/null, other text
 * becomes a quoted string. A spreadsheet holds data, not expressions.
 */
export function pastedResultCell(text: string): string {
  const trimmed = text.trim();
  if (trimmed === "") return "";
  if (/^(true|false|null)$/i.test(trimmed)) return trimmed.toLowerCase();
  if (isNumberLiteral(trimmed) && withinServerLimits(trimmed)) return trimmed;
  if (literalText(trimmed) !== null || isArrayLiteral(trimmed)) return trimmed;
  return quoteText(trimmed);
}

/**
 * Tab-separated text as spreadsheets copy it: a row per line, a cell per tab,
 * and a quoted cell may hold tabs, line breaks and doubled quotes.
 */
export function parseTabularText(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let index = 0;
  const endCell = () => {
    row.push(cell);
    cell = "";
  };
  while (index < text.length) {
    const character = text[index];
    if (cell === "" && character === '"') {
      // A quoted cell runs to the quote that no second quote follows.
      let end = index + 1;
      let value = "";
      while (end < text.length) {
        if (text[end] === '"') {
          if (text[end + 1] === '"') {
            value += '"';
            end += 2;
            continue;
          }
          break;
        }
        value += text[end++];
      }
      if (end < text.length) {
        cell = value;
        index = end + 1;
        continue;
      }
    }
    if (character === "\t") endCell();
    else if (character === "\n" || character === "\r") {
      endCell();
      rows.push(row);
      row = [];
      if (character === "\r" && text[index + 1] === "\n") index++;
    } else cell += character;
    index++;
  }
  if (cell !== "" || row.length) {
    endCell();
    rows.push(row);
  }
  return rows;
}

/** Whether pasted text holds more than one cell. */
export function isTabularText(text: string): boolean {
  return /[\t\n\r]/.test(text.replace(/[\r\n]+$/, ""));
}

// Table structure.

export const hitPolicies: readonly HitPolicy[] = ["FIRST", "UNIQUE", "COLLECT"];

/** How the editor names a match policy; null reads as FIRST, as on the server. */
export function hitPolicyLabel(policy: HitPolicy | null | undefined): string {
  switch (policy ?? "FIRST") {
    case "FIRST":
      return "First match";
    case "UNIQUE":
      return "Only one match";
    case "COLLECT":
      return "All matches (list)";
  }
}

/** The card's detail, short enough for its one line: "4 rows → shipping". */
export function decisionTableCardSummary(
  table: DecisionTable | null | undefined,
  output: string | null | undefined,
): string {
  if (!table) return "Add a table";
  return `${counted(table.rows.length, "row")} → ${output || "result"}`;
}

/** The inspector's summary: "3 conditions · 4 rows → shipping". */
export function decisionTableSummary(
  table: DecisionTable | null | undefined,
  output: string | null | undefined,
): string {
  if (!table) return "Add a table";
  return `${counted(table.conditions.length, "condition")} · ${counted(table.rows.length, "row")} → ${output || "result"}`;
}

/** A trace step's matched rows: "Row 3", "Rows 1, 3" or "No row". */
export function matchedRowsText(rows: readonly number[]): string {
  if (!rows.length) return "No row";
  return `${rows.length === 1 ? "Row" : "Rows"} ${rows.join(", ")}`;
}

/** A row as one line: `"gold" | - → 0`. */
export function rowText(row: DecisionTableRow): string {
  return `${row.when.join(" | ")} → ${row.then.join(" | ")}`;
}

/**
 * The table a new decision table node starts with: one condition on the
 * graph's first input parameter, one result and one row that matches any
 * value, so the card is complete once it is connected.
 */
export function newDecisionTable(
  definition: Pick<Definition, "inputs">,
): DecisionTable {
  const input = definition.inputs[0]?.name;
  return {
    hitPolicy: "FIRST",
    conditions: [{ label: input ?? "Condition 1", expression: input ?? "" }],
    results: [{ name: "value" }],
    rows: [{ when: ["-"], then: ["0"] }],
  };
}

/** A row that matches any value and returns nothing yet. */
export function emptyRow(table: DecisionTable): DecisionTableRow {
  return {
    when: table.conditions.map(() => "-"),
    then: table.results.map(() => ""),
  };
}

export function canAddRows(table: DecisionTable, count = 1): boolean {
  return table.rows.length + count <= MAX_TABLE_ROWS;
}

export function canAddCondition(table: DecisionTable): boolean {
  return table.conditions.length < MAX_TABLE_CONDITIONS;
}

export function canAddResult(table: DecisionTable): boolean {
  return table.results.length < MAX_TABLE_RESULTS;
}

/** `list` with `item` at `index`. */
export function inserted<T>(list: readonly T[], index: number, item: T): T[] {
  return [...list.slice(0, index), item, ...list.slice(index)];
}

/** `list` without the item at `index`. */
export function removed<T>(list: readonly T[], index: number): T[] {
  return list.filter((_, at) => at !== index);
}

/** `list` with the item at `from` moved to `to`. */
export function moved<T>(list: readonly T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length || from === to) return [...list];
  const next = removed(list, from);
  next.splice(to, 0, list[from]);
  return next;
}

/** A new condition column, appended; every row tests it with `-`. */
export function withConditionAdded(table: DecisionTable): DecisionTable {
  const label = uniqueName(
    "Condition ",
    table.conditions.map((condition) => condition.label),
    table.conditions.length + 1,
  );
  return {
    ...table,
    conditions: [...table.conditions, { label, expression: "" }],
    rows: table.rows.map((row) => ({ ...row, when: [...row.when, "-"] })),
  };
}

/** A new result column, appended with empty cells. */
export function withResultAdded(table: DecisionTable): DecisionTable {
  const name = uniqueName(
    "result",
    table.results.map((result) => result.name),
    table.results.length + 1,
  );
  return {
    ...table,
    results: [...table.results, { name }],
    rows: table.rows.map((row) => ({ ...row, then: [...row.then, ""] })),
  };
}

export type ColumnSide = "condition" | "result";

/** The table without a column and its cells. */
export function withColumnRemoved(
  table: DecisionTable,
  side: ColumnSide,
  index: number,
): DecisionTable {
  if (side === "condition")
    return {
      ...table,
      conditions: removed(table.conditions, index),
      rows: table.rows.map((row) => ({
        ...row,
        when: removed(row.when, index),
      })),
    };
  return {
    ...table,
    results: removed(table.results, index),
    rows: table.rows.map((row) => ({ ...row, then: removed(row.then, index) })),
  };
}

/** The table with a column and its cells moved. */
export function withColumnMoved(
  table: DecisionTable,
  side: ColumnSide,
  from: number,
  to: number,
): DecisionTable {
  if (side === "condition")
    return {
      ...table,
      conditions: moved(table.conditions, from, to),
      rows: table.rows.map((row) => ({
        ...row,
        when: moved(row.when, from, to),
      })),
    };
  return {
    ...table,
    results: moved(table.results, from, to),
    rows: table.rows.map((row) => ({
      ...row,
      then: moved(row.then, from, to),
    })),
  };
}

/**
 * The cells a pasted block fills from a row and a grid column (conditions
 * first, then results), and how many rows it adds below the table. Cells
 * beyond the last column and rows beyond the row limit are left out.
 */
export function withPastedCells(
  table: DecisionTable,
  rowIndex: number,
  column: number,
  block: readonly (readonly string[])[],
): { table: DecisionTable; addedRows: number; skippedCells: number } {
  const width = table.conditions.length + table.results.length;
  const room = MAX_TABLE_ROWS - rowIndex;
  const rows = [...table.rows];
  let skippedCells = 0;
  let addedRows = 0;
  block.forEach((cells, offset) => {
    if (offset >= room) {
      skippedCells += cells.length;
      return;
    }
    const target = rowIndex + offset;
    if (target >= rows.length) {
      rows.push(emptyRow(table));
      addedRows++;
    }
    const row = { when: [...rows[target].when], then: [...rows[target].then] };
    cells.forEach((text, at) => {
      const gridColumn = column + at;
      if (gridColumn >= width) skippedCells++;
      else if (gridColumn < table.conditions.length)
        row.when[gridColumn] = pastedTestCell(text);
      else
        row.then[gridColumn - table.conditions.length] = pastedResultCell(text);
    });
    rows[target] = row;
  });
  return { table: { ...table, rows }, addedRows, skippedCells };
}

/** Why a condition label cannot be stored: blank, too long or another column's. */
export function conditionLabelProblem(
  table: DecisionTable,
  index: number,
): string | null {
  const label = table.conditions[index].label;
  if (!label.trim()) return "Name the condition.";
  if (label.length > MAX_LABEL_CHARACTERS)
    return `Use at most ${MAX_LABEL_CHARACTERS} characters.`;
  if (
    table.conditions.some(
      (other, at) => at !== index && other.label.trim() === label.trim(),
    )
  )
    return "Another condition has this name.";
  return null;
}

/**
 * Why a result name cannot be stored: not an identifier, or another
 * result's. An empty name may wait in the draft; validation reports it.
 */
export function resultNameProblem(
  table: DecisionTable,
  index: number,
): string | null {
  const name = table.results[index].name;
  if (name === "") return null;
  const problem = identifierError(name);
  if (problem) return problem;
  if (table.results.some((other, at) => at !== index && other.name === name))
    return "Another result has this name.";
  return null;
}

/** Whether the server stores the table's structure: labels and names it accepts. */
export function tableStructureProblem(table: DecisionTable): string | null {
  for (let index = 0; index < table.conditions.length; index++) {
    const problem = conditionLabelProblem(table, index);
    if (problem) return `Condition ${index + 1}: ${problem}`;
  }
  for (let index = 0; index < table.results.length; index++) {
    const problem = resultNameProblem(table, index);
    if (problem) return `Result ${index + 1}: ${problem}`;
  }
  return null;
}
