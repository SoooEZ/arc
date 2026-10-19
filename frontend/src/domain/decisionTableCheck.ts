// The table check: hints about a decision table that the server only meets at
// run time. A first-match table may hold rows that the rows above always
// answer; a one-match table may hold rows that match the same values (such a
// run fails); and either may leave values that no row matches (such a run
// fails too). Each column's values are cut into the pieces its tests tell
// apart, so the check is exact, and a work budget bounds it. Null values are
// not checked: tests other than null, != null and - never match them.

import type { DecisionTable, HitPolicy } from "../types";
import {
  compareDecimals,
  parseTestCell,
  testCellProblems,
  type CellLiteral,
  type CellTest,
  type ParsedCell,
} from "./decisionTables";
import { quoteText } from "./expressions";
import { decimalTextParts, significantDigits } from "./json";
import { listed } from "./text";

export type TableHint =
  | { kind: "unreachable"; row: number }
  | { kind: "overlap"; rows: [number, number]; example: string }
  | { kind: "gap"; values: string };

export interface TableCheck {
  /** Why the table was not checked: a cell to fix, or nothing to check. */
  skipped: string | null;
  hints: TableHint[];
  /** The work budget ran out: hints may be missing. */
  incomplete: boolean;
}

/** How many uncovered value combinations the check names. */
const reportedGaps = 3;
const defaultBudget = 3_000_000;

/** The pieces a column's values fall into, and how to name a set of them. */
interface Column {
  label: string;
  pieces: number;
  /** The pieces where a test holds, as inclusive ranges of piece numbers. */
  ranges: (test: CellTest) => [number, number][];
  /** A test that matches exactly these pieces. */
  describe: (pieces: readonly number[]) => string;
}

/** A number's value as text, the same for 1, 1.0 and 1e0. */
function valueKey(text: string): string {
  const parts = decimalTextParts(text);
  if (!parts) throw new RangeError(`${text} is not a number`);
  const { digits, trailingZeros } = significantDigits(parts);
  if (!digits) return "0";
  const coefficient = digits.slice(0, digits.length - trailingZeros);
  const power =
    parts.exponent - BigInt(parts.fraction.length) + BigInt(trailingZeros);
  return `${parts.negative ? "-" : ""}${coefficient}e${power}`;
}

/** Every piece except `piece`. */
function except(piece: number, pieces: number): [number, number][] {
  return [
    [0, piece - 1],
    [piece + 1, pieces - 1],
  ];
}

function numberColumn(label: string, endpoints: string[]): Column {
  // Pieces alternate: the values below the first endpoint (0), the first
  // endpoint (1), the values between it and the next (2), and so on.
  const byValue = new Map(endpoints.map((text) => [valueKey(text), text]));
  const points = [...byValue.values()].sort(compareDecimals);
  const index = new Map(points.map((text, at) => [valueKey(text), at]));
  const at = (text: string) => index.get(valueKey(text)) ?? -1;
  const pieces = points.length * 2 + 1;
  const last = pieces - 1;
  const point = (text: string) => 2 * at(text) + 1;
  return {
    label,
    pieces,
    ranges: (test) => {
      switch (test.kind) {
        case "equals":
          return test.literal.type === "number"
            ? [[point(test.literal.text), point(test.literal.text)]]
            : [];
        case "notEquals":
          return test.literal.type === "number"
            ? except(point(test.literal.text), pieces)
            : [[0, last]];
        case "compare": {
          const on = point(test.number);
          if (test.operator === "<") return [[0, on - 1]];
          if (test.operator === "<=") return [[0, on]];
          if (test.operator === ">") return [[on + 1, last]];
          return [[on, last]];
        }
        case "range": {
          const low = point(test.low);
          const high = point(test.high);
          return [
            [
              test.lowIncluded ? low : low + 1,
              test.highIncluded ? high : high - 1,
            ],
          ];
        }
      }
    },
    describe: (chosen) => {
      const intervals: string[] = [];
      let start = 0;
      while (start < chosen.length) {
        let end = start;
        while (end + 1 < chosen.length && chosen[end + 1] === chosen[end] + 1)
          end++;
        intervals.push(interval(points, chosen[start], chosen[end]));
        start = end + 1;
      }
      return intervals.join(", ");
    },
  };
}

/** The test that matches pieces `first` to `last` of a number column. */
function interval(points: string[], first: number, last: number): string {
  const lowOpen = first % 2 === 0;
  const low = lowOpen ? first / 2 - 1 : (first - 1) / 2;
  const highOpen = last % 2 === 0;
  const high = highOpen ? last / 2 : (last - 1) / 2;
  const below = low < 0;
  const above = high >= points.length;
  if (below && above) return "-";
  if (below) return `${highOpen ? "<" : "<="} ${points[high]}`;
  if (above) return `${lowOpen ? ">" : ">="} ${points[low]}`;
  if (!lowOpen && !highOpen && low === high) return points[low];
  return `${points[low]}${lowOpen ? "<" : ""}..${highOpen ? "<" : ""}${points[high]}`;
}

/**
 * A column of named values: one piece per value a test names, then one for
 * every other value. `named` turns a literal into its piece, -1 when the
 * literal names no value of the column (null, another type).
 */
function namedColumn(
  label: string,
  pieces: number,
  named: (literal: CellLiteral) => number,
  describe: (chosen: readonly number[]) => string,
): Column {
  return {
    label,
    pieces,
    ranges: (test) => {
      if (test.kind !== "equals" && test.kind !== "notEquals") return [];
      const piece = named(test.literal);
      if (test.kind === "equals") return piece < 0 ? [] : [[piece, piece]];
      return piece < 0 ? [[0, pieces - 1]] : except(piece, pieces);
    },
    describe,
  };
}

function stringColumn(label: string, values: string[]): Column {
  const known = [...new Set(values)];
  const other = known.length;
  return namedColumn(
    label,
    known.length + 1,
    (literal) =>
      literal.type === "string" ? known.indexOf(literal.value) : -1,
    (chosen) => {
      if (!chosen.includes(other))
        return chosen.map((piece) => quoteText(known[piece])).join(", ");
      const excluded = known.filter((_, piece) => !chosen.includes(piece));
      return excluded.length
        ? `not(${excluded.map((text) => quoteText(text)).join(", ")})`
        : "-";
    },
  );
}

function booleanColumn(label: string): Column {
  // Piece 0 is true, piece 1 false.
  return namedColumn(
    label,
    2,
    (literal) => {
      if (literal.type !== "boolean") return -1;
      return literal.value ? 0 : 1;
    },
    (chosen) => (chosen.length === 2 ? "-" : String(chosen[0] === 0)),
  );
}

/** A column whose rows test no value but null: one piece, every non-null value. */
function anyColumn(label: string): Column {
  return namedColumn(
    label,
    1,
    () => -1,
    () => "-",
  );
}

function columnOf(label: string, cells: ParsedCell[]): Column {
  const numbers: string[] = [];
  const strings: string[] = [];
  let booleans = false;
  for (const cell of cells) {
    if (cell.kind === "any") continue;
    for (const test of cell.tests) {
      if (test.kind === "compare") numbers.push(test.number);
      else if (test.kind === "range") numbers.push(test.low, test.high);
      else if (test.literal.type === "number") numbers.push(test.literal.text);
      else if (test.literal.type === "string") strings.push(test.literal.value);
      else if (test.literal.type === "boolean") booleans = true;
    }
  }
  if (numbers.length) return numberColumn(label, numbers);
  if (strings.length) return stringColumn(label, strings);
  if (booleans) return booleanColumn(label);
  return anyColumn(label);
}

/** The pieces where a cell holds. */
function cellPieces(column: Column, cell: ParsedCell): Uint8Array {
  const pieces = new Uint8Array(column.pieces);
  if (cell.kind === "any") return pieces.fill(1);
  for (const test of cell.tests)
    for (const [first, last] of column.ranges(test))
      if (first <= last) pieces.fill(1, first, last + 1);
  if (cell.negated)
    for (let piece = 0; piece < pieces.length; piece++) pieces[piece] ^= 1;
  return pieces;
}

class OutOfBudget extends Error {}

/** Checks a table; an invalid cell or an unchecked mode skips the check. */
export function checkTable(
  table: DecisionTable,
  budget = defaultBudget,
): TableCheck {
  const policy: HitPolicy = table.hitPolicy ?? "FIRST";
  const skip = (skipped: string): TableCheck => ({
    skipped,
    hints: [],
    incomplete: false,
  });
  if (policy === "COLLECT")
    return skip(
      "With All matches, every matching row adds a value and no row is left out; there is nothing to check.",
    );
  if (!table.conditions.length || !table.rows.length)
    return skip("Add a condition and a row to check the table.");
  if (
    testCellProblems(table.rows, table.conditions.length).some((row) =>
      row.some(Boolean),
    )
  )
    return skip("Fix the marked cells to check the table.");
  const parsed = table.rows.map((row) =>
    row.when.map((text) => {
      const result = parseTestCell(text);
      if (!result.ok) throw new Error(result.problem);
      return result.cell;
    }),
  );
  const columns = table.conditions.map((condition, index) =>
    columnOf(
      condition.label,
      parsed.map((cells) => cells[index]),
    ),
  );
  let work = budget;
  const spend = (amount: number) => {
    work -= amount;
    if (work < 0) throw new OutOfBudget();
  };
  // member[row][column][piece]: whether the row's test holds on the piece.
  const membership = () =>
    parsed.map((cells) =>
      cells.map((cell, index) => {
        spend(columns[index].pieces);
        return cellPieces(columns[index], cell);
      }),
    );
  const describe = (choices: readonly (readonly number[] | null)[]) =>
    choices
      .map((pieces, index) => {
        const text = pieces ? columns[index].describe(pieces) : "-";
        return text === "-" ? null : `${columns[index].label}: ${text}`;
      })
      .filter(Boolean)
      .join(" · ") || "any value";
  /**
   * Searches the value combinations inside `box` (null: everywhere) that none
   * of `rows` matches, as pieces per column (null: every piece), and hands
   * each to `found`, which returns true to stop.
   */
  const searchUncovered = (
    rows: readonly number[],
    box: number | null,
    found: (choices: (readonly number[] | null)[]) => boolean,
  ) => {
    let stopped = false;
    const search = (
      column: number,
      candidates: readonly number[],
      choices: (readonly number[] | null)[],
    ) => {
      if (stopped) return;
      if (!candidates.length) {
        stopped = found([...choices, ...columns.slice(column).map(() => null)]);
        return;
      }
      if (column === columns.length) return;
      // Pieces that the same candidates match lead to the same answer.
      const groups = new Map<string, { pieces: number[]; rows: number[] }>();
      for (let piece = 0; piece < columns[column].pieces; piece++) {
        if (box !== null && !member[box][column][piece]) continue;
        spend(candidates.length);
        const rows = candidates.filter((row) => member[row][column][piece]);
        const key = rows.join(",");
        const group = groups.get(key);
        if (group) group.pieces.push(piece);
        else groups.set(key, { pieces: [piece], rows });
      }
      for (const group of groups.values())
        search(column + 1, group.rows, [...choices, group.pieces]);
    };
    search(0, rows, []);
  };
  /** Whether a row of `rows` matches a value inside the box `choices`. */
  const touches = (
    rows: readonly number[],
    choices: readonly (readonly number[] | null)[],
  ) =>
    rows.some((row) =>
      choices.every((pieces, column) => {
        spend(pieces?.length ?? columns[column].pieces);
        return pieces
          ? pieces.some((piece) => member[row][column][piece])
          : member[row][column].includes(1);
      }),
    );
  /**
   * An uncovered box with every column widened to all its values where no
   * row then matches: "Region other than these" rather than one such box for
   * every tier and amount the search split it by.
   */
  const widened = (
    rows: readonly number[],
    choices: (readonly number[] | null)[],
  ) => {
    const box = [...choices];
    for (let column = 0; column < box.length; column++) {
      if (box[column] === null) continue;
      const wider = [...box];
      wider[column] = null;
      if (!touches(rows, wider)) box[column] = null;
    }
    return box;
  };
  let member: Uint8Array[][] = [];
  const hints: TableHint[] = [];
  let incomplete = false;
  try {
    member = membership();
    const all = table.rows.map((_, index) => index);
    // A row whose tests hold for no value but null is not checked, as null is not.
    const testsValues = (row: number) =>
      member[row].every((pieces) => pieces.includes(1));
    const reachable = (row: number) => {
      let found = false;
      searchUncovered(all.slice(0, row), row, () => (found = true));
      return found;
    };
    // Uncovered values first, so a table with many overlapping rows still
    // names them before the budget runs out; the list shows them last.
    const gaps = new Set<string>();
    searchUncovered(all, null, (choices) => {
      gaps.add(describe(widened(all, choices)));
      return gaps.size >= reportedGaps;
    });
    const gapHints: TableHint[] = [...gaps].map((values) => ({
      kind: "gap",
      values,
    }));
    try {
      if (policy === "FIRST")
        for (let row = 1; row < table.rows.length; row++)
          if (testsValues(row) && !reachable(row))
            hints.push({ kind: "unreachable", row: row + 1 });
      if (policy === "UNIQUE")
        for (let first = 0; first < table.rows.length; first++)
          for (let second = first + 1; second < table.rows.length; second++) {
            const shared: number[][] = [];
            for (let column = 0; column < columns.length; column++) {
              spend(columns[column].pieces);
              const pieces: number[] = [];
              for (let piece = 0; piece < columns[column].pieces; piece++)
                if (
                  member[first][column][piece] &&
                  member[second][column][piece]
                )
                  pieces.push(piece);
              if (!pieces.length) break;
              shared.push(pieces);
            }
            if (shared.length === columns.length)
              hints.push({
                kind: "overlap",
                rows: [first + 1, second + 1],
                example: describe(shared.map((pieces) => [pieces[0]])),
              });
          }
    } finally {
      hints.push(...gapHints);
    }
  } catch (error) {
    if (!(error instanceof OutOfBudget)) throw error;
    incomplete = true;
  }
  return { skipped: null, hints, incomplete };
}

/** A hint as the check list says it. */
export function hintText(hint: TableHint): string {
  switch (hint.kind) {
    case "unreachable":
      return `Row ${hint.row} never matches: the rows above match every value it tests.`;
    case "overlap":
      return `Rows ${listed(hint.rows.map(String))} can both match, for example ${hint.example}. With Only one match, such a run fails.`;
    case "gap":
      return `No row matches ${hint.values}. Such a run fails.`;
  }
}
