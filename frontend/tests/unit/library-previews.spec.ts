import { expect, test } from "@playwright/test";
import type { Rule } from "../../src/types";
import {
  cachedPreview,
  rememberPreview,
} from "../../src/features/library/previewCache";
import { lastPageOffset } from "../../src/hooks/usePagedResource";

const rule = (id: string, revision: number): Rule => ({
  id,
  name: id,
  description: "",
  kind: "FORMULA",
  revision,
  publishedVersion: null,
  createdAt: "2026-09-27T00:00:00Z",
  updatedAt: "2026-09-27T00:00:00Z",
  draft: { schemaVersion: 1, inputs: [], nodes: [], edges: [] },
});

test("card previews are reused per rule revision and stay bounded", () => {
  const first = rule("preview-cache-first", 1);
  expect(cachedPreview(first)).toBeUndefined();
  rememberPreview(first, first);
  expect(cachedPreview({ ...first, revision: 1 })).toBe(first);
  // A saved draft has a new revision, so its old preview is never shown.
  expect(cachedPreview({ ...first, revision: 2 })).toBeUndefined();
  // A rule created again under a deleted ID is another rule, whatever its revision.
  expect(
    cachedPreview({ ...first, createdAt: "2026-09-28T00:00:00Z" }),
  ).toBeUndefined();

  for (let index = 0; index < 40; index++) {
    const other = rule(`preview-cache-${index}`, 1);
    rememberPreview(other, other);
  }
  expect(cachedPreview(first)).toBeUndefined();
  expect(cachedPreview(rule("preview-cache-39", 1))).toBeDefined();
  expect(cachedPreview(rule("preview-cache-0", 1))).toBeDefined();
});

test("a page offset past the end moves to the last page", () => {
  expect(lastPageOffset(0, 20)).toBe(0);
  expect(lastPageOffset(1, 20)).toBe(0);
  expect(lastPageOffset(20, 20)).toBe(0);
  expect(lastPageOffset(21, 20)).toBe(20);
  expect(lastPageOffset(40, 20)).toBe(20);
  expect(lastPageOffset(41, 20)).toBe(40);
});
