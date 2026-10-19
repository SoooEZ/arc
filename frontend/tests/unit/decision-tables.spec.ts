import { expect, test } from "@playwright/test";
import {
  canAddCondition,
  canAddResult,
  canAddRows,
  committedTestCell,
  compareDecimals,
  conditionLabelProblem,
  decisionTableCardSummary,
  decisionTableSummary,
  emptyRow,
  hitPolicyLabel,
  inserted,
  isTabularText,
  literalType,
  matchedRowsText,
  moved,
  newDecisionTable,
  parseTabularText,
  parseTestCell,
  pastedResultCell,
  pastedTestCell,
  removed,
  resultNameProblem,
  rowText,
  tableStructureProblem,
  testCellProblems,
  testGuidance,
  testsAreValid,
  withColumnMoved,
  withColumnRemoved,
  withConditionAdded,
  withPastedCells,
  withResultAdded,
} from "../../src/domain/decisionTables";
import {
  MAX_TABLE_CONDITIONS,
  MAX_TABLE_RESULTS,
  MAX_TABLE_ROWS,
} from "../../src/domain/limits";
import type { DecisionTable } from "../../src/types";

const shipping: DecisionTable = {
  hitPolicy: "FIRST",
  conditions: [
    { label: "Tier", expression: "tier" },
    { label: "Order amount", expression: "amount" },
  ],
  results: [{ name: "fee" }],
  rows: [
    { when: ['"gold"', "-"], then: ["0"] },
    { when: ["-", ">= 100"], then: ["0"] },
    { when: ["-", "-"], then: ["8"] },
  ],
};

function cell(text: string) {
  const parsed = parseTestCell(text);
  if (!parsed.ok) throw new Error(parsed.problem);
  return parsed.cell;
}

function problem(text: string) {
  const parsed = parseTestCell(text);
  return parsed.ok ? null : parsed.problem;
}

test("a test cell reads a value, a comparison, a range, a list, not(…) or any value", () => {
  expect(cell("-")).toEqual({ kind: "any" });
  expect(cell("  -  ")).toEqual({ kind: "any" });
  expect(cell('"gold"')).toEqual({
    kind: "tests",
    negated: false,
    tests: [{ kind: "equals", literal: { type: "string", value: "gold" } }],
  });
  // Single quotes and escapes read as ARC strings do.
  expect(cell("'it\\'s'")).toEqual(cell('"it\'s"'));
  expect(cell('"a\\u0041"')).toEqual(cell('"aA"'));
  for (const number of ["100", "-5", "0.25", ".5", "1e3", "-1.5E-2"])
    expect(cell(number), number).toEqual({
      kind: "tests",
      negated: false,
      tests: [{ kind: "equals", literal: { type: "number", text: number } }],
    });
  expect(cell("true")).toEqual({
    kind: "tests",
    negated: false,
    tests: [{ kind: "equals", literal: { type: "boolean", value: true } }],
  });
  expect(cell("null").kind).toBe("tests");
  expect(cell('!= "x"')).toEqual({
    kind: "tests",
    negated: false,
    tests: [{ kind: "notEquals", literal: { type: "string", value: "x" } }],
  });
  expect(cell(">=100")).toEqual(cell(">= 100"));
  expect(cell("< -5")).toEqual({
    kind: "tests",
    negated: false,
    tests: [{ kind: "compare", operator: "<", number: "-5" }],
  });
  const range = (text: string) => cell(text);
  expect(range("100..500")).toEqual({
    kind: "tests",
    negated: false,
    tests: [
      {
        kind: "range",
        low: "100",
        high: "500",
        lowIncluded: true,
        highIncluded: true,
      },
    ],
  });
  const bounds = (text: string) => {
    const parsed = cell(text);
    if (parsed.kind !== "tests" || parsed.tests[0].kind !== "range")
      throw new Error(text);
    const { lowIncluded, highIncluded } = parsed.tests[0];
    return [lowIncluded, highIncluded];
  };
  expect(bounds("100..<500")).toEqual([true, false]);
  expect(bounds("100<..500")).toEqual([false, true]);
  expect(bounds("100<..<500")).toEqual([false, false]);
  // No trailing dot: 5..10 is 5, .., 10; decimals and signs keep their place.
  expect(bounds("5..10")).toEqual([true, true]);
  expect(bounds("-10..<-5")).toEqual([true, false]);
  expect(bounds(".5..1.5")).toEqual([true, true]);
  expect(bounds("5..5")).toEqual([true, true]);
  const list = cell('"gold", "platinum", >= 1000');
  expect(list.kind === "tests" && list.tests.length).toBe(3);
  expect(cell('not("gold", "silver")')).toMatchObject({
    kind: "tests",
    negated: true,
  });
  expect(cell('not ( "gold" )')).toMatchObject({ negated: true });
});

test("a cell that is no test says what to write", () => {
  expect(problem("")).toBe("Enter a test, or - for any value.");
  expect(problem("gold")).toBe(`Put text in quotes. ${testGuidance}`);
  expect(problem('>= "gold"')).toBe("Comparisons and ranges take numbers.");
  expect(problem('"a".."b"')).toBe("Comparisons and ranges take numbers.");
  expect(problem("500..100")).toBe(
    "This range holds no value: write the lower bound first.",
  );
  expect(problem("5..<5")).toBe(
    "This range holds no value: write the lower bound first.",
  );
  expect(problem('= "gold"')).toBe(
    'Write the value alone: "gold", not = "gold".',
  );
  expect(problem('"gold')).toBe("Close the quote.");
  expect(problem('"gold", -')).toBe("- stands alone: it matches any value.");
  expect(problem("not(")).toBe("Write not( … ) around the values it excludes.");
  expect(problem('not "gold"')).toBe(
    "Write not( … ) around the values it excludes.",
  );
  expect(problem('"a",, "b"')).toBe(testGuidance);
  expect(problem("1e101")).toMatch(/too large or too precise/);
  // The server's number token has no leading-dot exponent.
  expect(problem(".5e3")).not.toBeNull();
  expect(problem("amount")).toBe(`Put text in quotes. ${testGuidance}`);
  expect(problem("x == 1")).not.toBeNull();
  expect(problem("(1)")).toBe(testGuidance);
});

test("a long string cell is read in a loop, without recursion", () => {
  const text = `"${'a\\"'.repeat(10_000)}"`;
  const parsed = cell(text);
  expect(
    parsed.kind === "tests" &&
      parsed.tests[0].kind === "equals" &&
      parsed.tests[0].literal.type === "string" &&
      parsed.tests[0].literal.value.length,
  ).toBe(20_000);
});

test("numbers compare by value, as the server's decimals do", () => {
  expect(compareDecimals("1", "1.0")).toBe(0);
  expect(compareDecimals("0", "-0.00")).toBe(0);
  expect(compareDecimals("-5", ".5")).toBe(-1);
  expect(compareDecimals("1e3", "999.9")).toBe(1);
  expect(compareDecimals("2.50", "2.5e0")).toBe(0);
  expect(literalType({ type: "null" })).toBeNull();
  expect(literalType({ type: "number", text: "1" })).toBe("number");
});

test("cells name their syntax problems and a column's type mix", () => {
  const table: DecisionTable = {
    ...shipping,
    rows: [
      { when: ['"gold"', ">= 100"], then: ["0"] },
      { when: ["100", "gold"], then: ["1"] },
      { when: ["null", "-"], then: ["2"] },
    ],
  };
  expect(testCellProblems(table.rows, table.conditions.length)).toEqual([
    [null, null],
    [
      "This column tests text (row 1); a column tests one type of value.",
      `Put text in quotes. ${testGuidance}`,
    ],
    [null, null],
  ]);
  expect(testsAreValid(table)).toBe(false);
  expect(testsAreValid(shipping)).toBe(true);
});

test("bare text is quoted when a test cell is left; tests stay as typed", () => {
  expect(committedTestCell("gold")).toBe('"gold"');
  expect(committedTestCell("  New York ")).toBe('"New York"');
  expect(committedTestCell("gold, silver")).toBe('"gold", "silver"');
  expect(committedTestCell('gold, "silver", >= 5')).toBe(
    '"gold", "silver", >= 5',
  );
  expect(committedTestCell("not(gold, silver)")).toBe('not("gold", "silver")');
  expect(committedTestCell("TRUE")).toBe("true");
  expect(committedTestCell("Null")).toBe("null");
  expect(committedTestCell(" >= 100 ")).toBe(">= 100");
  expect(committedTestCell('say "hi"')).toBe('say "hi"');
  // A number the server refuses stays a number, marked, never text.
  expect(committedTestCell("1e999")).toBe("1e999");
  expect(committedTestCell('he said \\"')).toBe('he said \\"');
  expect(committedTestCell("")).toBe("");
  expect(committedTestCell("a\\b")).toBe('"a\\\\b"');
});

test("pasted spreadsheet cells become tests and values", () => {
  expect(pastedTestCell("")).toBe("-");
  expect(pastedTestCell("  ")).toBe("-");
  expect(pastedTestCell("gold")).toBe('"gold"');
  expect(pastedTestCell(">=100")).toBe(">=100");
  expect(pastedTestCell("FALSE")).toBe("false");
  expect(pastedResultCell("")).toBe("");
  expect(pastedResultCell(" 12.50 ")).toBe("12.50");
  expect(pastedResultCell("TRUE")).toBe("true");
  expect(pastedResultCell("UPS")).toBe('"UPS"');
  expect(pastedResultCell("Next day")).toBe('"Next day"');
  expect(pastedResultCell('"quoted"')).toBe('"quoted"');
  expect(pastedResultCell("[1, 2]")).toBe("[1, 2]");
  expect(pastedResultCell("1,234")).toBe('"1,234"');
  expect(pastedResultCell("amount * 2")).toBe('"amount * 2"');
});

test("tab-separated text reads as spreadsheets copy it", () => {
  expect(parseTabularText("a\tb\r\nc\td\r\n")).toEqual([
    ["a", "b"],
    ["c", "d"],
  ]);
  expect(parseTabularText('"x\ty"\t"say ""hi"""\n"two\nlines"\t\n')).toEqual([
    ["x\ty", 'say "hi"'],
    ["two\nlines", ""],
  ]);
  expect(parseTabularText("only")).toEqual([["only"]]);
  expect(parseTabularText('"open\tquote')).toEqual([['"open', "quote"]]);
  expect(isTabularText("one\r\n")).toBe(false);
  expect(isTabularText("one\ttwo")).toBe(true);
  expect(isTabularText("one\ntwo")).toBe(true);
});

test("a new table tests the first input and matches any value", () => {
  expect(newDecisionTable({ inputs: [] })).toEqual({
    hitPolicy: "FIRST",
    conditions: [{ label: "Condition 1", expression: "" }],
    results: [{ name: "value" }],
    rows: [{ when: ["-"], then: ["0"] }],
  });
  expect(
    newDecisionTable({
      inputs: [
        { name: "amount", type: "NUMBER", required: true, defaultValue: null },
      ],
    }).conditions,
  ).toEqual([{ label: "amount", expression: "amount" }]);
  expect(emptyRow(shipping)).toEqual({ when: ["-", "-"], then: [""] });
});

test("columns are added, removed and moved with their cells", () => {
  const added = withConditionAdded(shipping);
  expect(added.conditions.at(-1)).toEqual({
    label: "Condition 3",
    expression: "",
  });
  expect(added.rows.map((row) => row.when.at(-1))).toEqual(["-", "-", "-"]);
  const taken = withConditionAdded({
    ...shipping,
    conditions: [
      ...shipping.conditions,
      { label: "Condition 3", expression: "x" },
    ],
    rows: shipping.rows.map((row) => ({ ...row, when: [...row.when, "-"] })),
  });
  expect(taken.conditions.at(-1)?.label).toBe("Condition 4");
  const results = withResultAdded(shipping);
  expect(results.results).toEqual([{ name: "fee" }, { name: "result2" }]);
  expect(results.rows[0].then).toEqual(["0", ""]);
  expect(withColumnRemoved(shipping, "condition", 0)).toEqual({
    ...shipping,
    conditions: [{ label: "Order amount", expression: "amount" }],
    rows: [
      { when: ["-"], then: ["0"] },
      { when: [">= 100"], then: ["0"] },
      { when: ["-"], then: ["8"] },
    ],
  });
  expect(withColumnRemoved(results, "result", 0).rows[2].then).toEqual([""]);
  const swapped = withColumnMoved(shipping, "condition", 0, 1);
  expect(swapped.conditions.map((c) => c.label)).toEqual([
    "Order amount",
    "Tier",
  ]);
  expect(swapped.rows[0].when).toEqual(["-", '"gold"']);
  expect(withColumnMoved(results, "result", 1, 0).rows[0].then).toEqual([
    "",
    "0",
  ]);
  // Out of range moves change nothing.
  expect(withColumnMoved(shipping, "condition", 0, -1)).toEqual(shipping);
  expect(inserted([1, 2], 1, 9)).toEqual([1, 9, 2]);
  expect(removed([1, 2, 3], 1)).toEqual([1, 3]);
  expect(moved([1, 2, 3], 0, 2)).toEqual([2, 3, 1]);
});

test("a pasted block fills cells from the focused one and adds rows", () => {
  const pasted = withPastedCells(shipping, 2, 1, [
    [">=50", "UPS", "extra"],
    ["", "12"],
  ]);
  expect(pasted.addedRows).toBe(1);
  expect(pasted.skippedCells).toBe(1);
  expect(pasted.table.rows.slice(2)).toEqual([
    { when: ["-", ">=50"], then: ['"UPS"'] },
    { when: ["-", "-"], then: ["12"] },
  ]);
  const full: DecisionTable = {
    ...shipping,
    rows: Array.from({ length: MAX_TABLE_ROWS }, () => emptyRow(shipping)),
  };
  const capped = withPastedCells(full, MAX_TABLE_ROWS - 1, 0, [
    ['"a"'],
    ['"b"'],
  ]);
  expect(capped.table.rows).toHaveLength(MAX_TABLE_ROWS);
  expect(capped.skippedCells).toBe(1);
  expect(canAddRows(full)).toBe(false);
  expect(canAddRows(shipping, 2)).toBe(true);
});

test("labels and result names follow the server's rules", () => {
  const table: DecisionTable = {
    ...shipping,
    conditions: [
      { label: " ", expression: "a" },
      { label: "Tier", expression: "b" },
      { label: "Tier ", expression: "c" },
      { label: "x".repeat(161), expression: "d" },
    ],
    results: [{ name: "" }, { name: "1fee" }, { name: "fee" }, { name: "fee" }],
  };
  expect(conditionLabelProblem(table, 0)).toBe("Name the condition.");
  expect(conditionLabelProblem(table, 1)).toBe(
    "Another condition has this name.",
  );
  expect(conditionLabelProblem(table, 3)).toBe("Use at most 160 characters.");
  expect(resultNameProblem(table, 0)).toBeNull();
  expect(resultNameProblem(table, 1)).toMatch(/^Use letters, digits/);
  expect(resultNameProblem(table, 2)).toBe("Another result has this name.");
  expect(tableStructureProblem(table)).toBe("Condition 1: Name the condition.");
  expect(tableStructureProblem(shipping)).toBeNull();
  expect(
    canAddCondition({
      ...shipping,
      conditions: Array.from({ length: MAX_TABLE_CONDITIONS }, (_, index) => ({
        label: `c${index}`,
        expression: "",
      })),
    }),
  ).toBe(false);
  expect(
    canAddResult({
      ...shipping,
      results: Array.from({ length: MAX_TABLE_RESULTS }, (_, index) => ({
        name: `r${index}`,
      })),
    }),
  ).toBe(false);
});

test("summaries name the match policy, the matched rows and the table", () => {
  expect(hitPolicyLabel(null)).toBe("First match");
  expect(hitPolicyLabel("UNIQUE")).toBe("Only one match");
  expect(hitPolicyLabel("COLLECT")).toBe("All matches (list)");
  expect(matchedRowsText([3])).toBe("Row 3");
  expect(matchedRowsText([1, 3])).toBe("Rows 1, 3");
  expect(matchedRowsText([])).toBe("No row");
  expect(decisionTableSummary(shipping, "shipping")).toBe(
    "2 conditions · 3 rows → shipping",
  );
  expect(decisionTableSummary(null, null)).toBe("Add a table");
  expect(decisionTableCardSummary(shipping, "shipping")).toBe(
    "3 rows → shipping",
  );
  expect(decisionTableCardSummary(null, null)).toBe("Add a table");
  expect(rowText(shipping.rows[0])).toBe('"gold" | - → 0');
});
