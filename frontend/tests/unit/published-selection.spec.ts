import { expect, test } from "@playwright/test";
import {
  knownVersion,
  newestKnownRelease,
  noRelease,
  selectionAfterCatalogPage,
} from "../../src/features/execution/publishedSelection";
import { ruleIncarnation, sameRule } from "../../src/domain/ruleIdentity";
import type { RuleSummary } from "../../src/types";

function summary(
  id: string,
  publishedVersion: number,
  createdAt = "2026-09-27T00:00:00Z",
): RuleSummary {
  return {
    id,
    name: id,
    description: "",
    kind: "FORMULA",
    revision: publishedVersion,
    publishedVersion,
    createdAt,
    updatedAt: createdAt,
    nodeCount: 2,
    inputCount: 1,
    referenceCount: 0,
  };
}

test("a rule is identified by its ID and creation time, not by its ID alone", () => {
  const first = summary("tax", 2);
  const again = summary("tax", 1, "2026-09-28T00:00:00Z");
  expect(sameRule(first, summary("tax", 5))).toBe(true);
  expect(sameRule(first, again)).toBe(false);
  expect(ruleIncarnation(first)).not.toBe(ruleIncarnation(again));
});

test("a catalog page replaces the selection for a newer release or another incarnation only", () => {
  const selected = summary("tax", 2);
  expect(
    selectionAfterCatalogPage(null, [
      summary("a", 1),
      summary("order-pricing", 1),
    ]),
  ).toMatchObject({ id: "order-pricing" });
  expect(selectionAfterCatalogPage(selected, [summary("other", 9)])).toBe(
    selected,
  );
  expect(selectionAfterCatalogPage(selected, [summary("tax", 1)])).toBe(
    selected,
  );
  expect(
    selectionAfterCatalogPage(selected, [summary("tax", 3)]),
  ).toMatchObject({
    publishedVersion: 3,
  });
  // Deleted and created again: the new rule wins although its version is lower.
  const recreated = summary("tax", 1, "2026-09-28T00:00:00Z");
  expect(selectionAfterCatalogPage(selected, [recreated])).toBe(recreated);
});

test("releases learned from history belong to one incarnation", () => {
  const selected = summary("tax", 2);
  const known = newestKnownRelease(noRelease, selected, 3);
  expect(knownVersion(known, selected)).toBe(3);
  expect(newestKnownRelease(known, selected, 2)).toBe(known);
  const recreated = summary("tax", 1, "2026-09-28T00:00:00Z");
  expect(knownVersion(known, recreated)).toBe(0);
  expect(newestKnownRelease(known, recreated, 1)).toMatchObject({ version: 1 });
  expect(knownVersion(known, null)).toBe(0);
});
