import { test, expect } from "@playwright/test";
import {
  cellText,
  cellValue,
  lookupEntries,
  readLookupTable,
} from "../../src/features/sources/lookupTable";
import { parseJson, stringifyJson } from "../../src/domain/json";

test("records read as a column per field, in first-seen order", () => {
  const read = readLookupTable(
    '{"DE": {"rate": 0.19, "currency": "EUR"}, "US": {"rate": 0.07, "state": true}}',
  );
  expect(read.error).toBeNull();
  expect(read.table?.fields).toEqual(["rate", "currency", "state"]);
  expect(read.table?.rows.map((row) => row.key)).toEqual(["DE", "US"]);
});

test("plain or mixed entries read as one value column; empty text is an empty table", () => {
  expect(readLookupTable('{"a": 1, "b": {"x": 2}}').table?.fields).toBeNull();
  expect(readLookupTable("").table).toEqual({ fields: [], rows: [] });
  expect(readLookupTable("{").error).toBeTruthy();
  expect(readLookupTable("[1]").error).toBe(
    "The entries must be one JSON object",
  );
});

test("a cell shows text as typed and other values as JSON, and reads back the value it shows", () => {
  const values: unknown[] = [
    "EUR",
    "12",
    "true",
    "",
    12.5,
    true,
    null,
    [1, 2],
    { a: 1 },
    parseJson("0.070"),
    parseJson("12345678901234567890"),
  ];
  for (const value of values) {
    const text = cellText(value);
    expect(stringifyJson(cellValue(text)), text).toBe(stringifyJson(value));
  }
  expect(cellText("12")).toBe('"12"');
  expect(cellText("EUR")).toBe("EUR");
  expect(cellText(parseJson("0.070"))).toBe("0.070");
  expect(cellValue("007")).toBe("007");
});

test("a table writes the entries back as the JSON view formats them", () => {
  const rows = [
    { key: "DE", value: { rate: parseJson("0.190") } },
    { key: "US", value: { rate: 0.07 } },
  ];
  expect(lookupEntries(rows)).toBe(
    '{\n  "DE": {\n    "rate": 0.190\n  },\n  "US": {\n    "rate": 0.07\n  }\n}',
  );
});
