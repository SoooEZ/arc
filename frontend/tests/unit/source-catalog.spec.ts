import { expect, test } from "@playwright/test";
import type { Page, SourceSummary } from "../../src/types";
import {
  catalogRows,
  rememberSavedSource,
  type SavedSource,
} from "../../src/features/sources/sourceCatalog";

const summary = (id: string, version = 1): SourceSummary => ({
  id,
  name: id.toUpperCase(),
  version,
  kind: "LOOKUP",
});
const page = (
  items: SourceSummary[],
  offset = 0,
  total = items.length,
): Page<SourceSummary> => ({ items, total, offset, limit: 3 });

test("a saved summary replaces only older catalog rows of its source", () => {
  const saved: SavedSource[] = [{ summary: summary("a", 3), revision: 1 }];
  expect(
    catalogRows(page([summary("a", 2), summary("b")]), saved, 1).rows,
  ).toEqual([summary("a", 3), summary("b")]);
  expect(
    catalogRows(page([summary("a", 4), summary("b")]), saved, 1).rows,
  ).toEqual([summary("a", 4), summary("b")]);
});

test("saved sources lead the first page only until a later read lists them", () => {
  const saved = [
    { summary: summary("new-2"), revision: 2 },
    { summary: summary("new-1"), revision: 1 },
  ];
  const loading = catalogRows(page([], 0, 0), saved, 0);
  expect(loading.rows.map((row) => row.id)).toEqual(["new-2", "new-1"]);
  expect(loading.total).toBe(2);

  // A read issued after the first save decides where "new-1" belongs.
  const partlyListed = catalogRows(page([summary("x")], 0, 1), saved, 1);
  expect(partlyListed.rows.map((row) => row.id)).toEqual(["new-2", "x"]);
  expect(partlyListed.total).toBe(2);

  // After a read that follows every save, the server's page is authoritative.
  expect(
    catalogRows(page([summary("x")], 0, 1), saved, 2).rows.map((r) => r.id),
  ).toEqual(["x"]);
  // Other pages never receive pending rows, and a page keeps its size.
  expect(
    catalogRows(page([summary("x")], 3, 4), saved, 0).rows.map((r) => r.id),
  ).toEqual(["x"]);
  expect(
    catalogRows(
      page([summary("x"), summary("y"), summary("z")], 0, 5),
      saved,
      0,
    ).rows.map((row) => row.id),
  ).toEqual(["new-2", "new-1", "x"]);
});

test("remembered saves are newest first, unique per source and bounded", () => {
  let saved: SavedSource[] = [];
  saved = rememberSavedSource(saved, { summary: summary("a"), revision: 1 }, 2);
  saved = rememberSavedSource(saved, { summary: summary("b"), revision: 2 }, 2);
  saved = rememberSavedSource(
    saved,
    { summary: summary("a", 2), revision: 3 },
    2,
  );
  expect(saved.map(({ summary, revision }) => [summary.id, revision])).toEqual([
    ["a", 3],
    ["b", 2],
  ]);
  saved = rememberSavedSource(saved, { summary: summary("c"), revision: 4 }, 2);
  expect(saved.map(({ summary }) => summary.id)).toEqual(["c", "a"]);
});
