import { expect, test } from "@playwright/test";
import {
  checkTable,
  hintText,
  type TableHint,
} from "../../src/domain/decisionTableCheck";
import type { DecisionTable, HitPolicy } from "../../src/types";

function table(
  labels: string[],
  rows: string[][],
  hitPolicy: HitPolicy = "FIRST",
): DecisionTable {
  return {
    hitPolicy,
    conditions: labels.map((label) => ({ label, expression: label })),
    results: [{ name: "value" }],
    rows: rows.map((when, index) => ({ when, then: [String(index)] })),
  };
}

const texts = (hints: TableHint[]) => hints.map(hintText);

test("a first-match table names the values no row matches", () => {
  const shipping = table(
    ["Tier", "Amount", "Region"],
    [
      ['"gold"', "-", '"domestic"'],
      ["-", ">= 100", '"domestic"'],
      ["-", "< 100", '"domestic"'],
      ["-", "-", '"overseas"'],
    ],
  );
  expect(texts(checkTable(shipping).hints)).toEqual([
    'No row matches Region: not("domestic", "overseas"). Such a run fails.',
  ]);
  const covered = table(["Tier"], [['"gold"'], ["-"]]);
  expect(checkTable(covered)).toEqual({
    skipped: null,
    hints: [],
    incomplete: false,
  });
});

test("a row the rows above always answer never matches, even through several rows", () => {
  const single = table(
    ["Tier", "Amount"],
    [
      ['"gold"', "-"],
      ['"gold"', ">= 100"],
      ["-", "-"],
    ],
  );
  expect(texts(checkTable(single).hints)).toEqual([
    "Row 2 never matches: the rows above match every value it tests.",
  ]);
  const union = table(["Amount"], [["< 100"], [">= 100"], ["5"], ["-"]]);
  expect(checkTable(union).hints).toEqual([
    { kind: "unreachable", row: 3 },
    { kind: "unreachable", row: 4 },
  ]);
  // A row that tests null alone is not checked, as null values are not.
  expect(checkTable(table(["Amount"], [["-"], ["null"]])).hints).toEqual([]);
});

test("number gaps are named as tests: points, sides and ranges", () => {
  expect(
    texts(checkTable(table(["Amount"], [["< 100"], ["> 100"]])).hints),
  ).toEqual(["No row matches Amount: 100. Such a run fails."]);
  expect(
    texts(checkTable(table(["Amount"], [["0..<100"], ["100..500"]])).hints),
  ).toEqual(["No row matches Amount: < 0, > 500. Such a run fails."]);
  expect(
    texts(
      checkTable(table(["Amount"], [["<= 0"], ["10<..<20"], [">= 30"]])).hints,
    ),
  ).toEqual(["No row matches Amount: 0<..10, 20..<30. Such a run fails."]);
  // 1 and 1.0 are one value.
  expect(
    checkTable(table(["Amount"], [["< 1"], ["1.0"], ["> 1"]])).hints,
  ).toEqual([]);
  expect(texts(checkTable(table(["Flag"], [["true"]])).hints)).toEqual([
    "No row matches Flag: false. Such a run fails.",
  ]);
  expect(checkTable(table(["Tier"], [['not("a")'], ['"a"']])).hints).toEqual(
    [],
  );
  expect(
    texts(
      checkTable(
        table(
          ["Tier", "Flag"],
          [
            ['"a"', "-"],
            ['"b"', "true"],
          ],
        ),
      ).hints,
    ),
  ).toEqual([
    'No row matches Tier: "b" · Flag: false. Such a run fails.',
    'No row matches Tier: not("a", "b"). Such a run fails.',
  ]);
});

test("a one-match table names the rows that match the same values", () => {
  const overlapping = table(
    ["Tier", "Amount"],
    [
      ['"gold"', "-"],
      ["-", ">= 100"],
      ['not("gold")', "< 100"],
    ],
    "UNIQUE",
  );
  expect(texts(checkTable(overlapping).hints)).toEqual([
    'Rows 1 and 2 can both match, for example Tier: "gold" · Amount: 100. With Only one match, such a run fails.',
  ]);
  const disjoint = table(["Amount"], [["< 100"], [">= 100"]], "UNIQUE");
  expect(checkTable(disjoint).hints).toEqual([]);
});

test("the check waits for valid cells, skips All matches and stops at its budget", () => {
  expect(checkTable(table(["Tier"], [["gold"]])).skipped).toBe(
    "Fix the marked cells to check the table.",
  );
  expect(checkTable(table(["Tier"], [['"a"'], ["1"]])).skipped).toBe(
    "Fix the marked cells to check the table.",
  );
  expect(checkTable(table(["Tier"], [['"a"']], "COLLECT")).skipped).toMatch(
    /^With All matches/,
  );
  expect(checkTable(table([], [])).skipped).toBe(
    "Add a condition and a row to check the table.",
  );
  const wide = table(
    Array.from({ length: 6 }, (_, index) => `c${index}`),
    Array.from({ length: 40 }, (_, row) =>
      Array.from(
        { length: 6 },
        (_, column) => `${row * 7 + column}..${row * 7 + column + 3}`,
      ),
    ),
  );
  const stopped = checkTable(wide, 2_000);
  expect(stopped.incomplete).toBe(true);
  expect(checkTable(wide).incomplete).toBe(false);
});
