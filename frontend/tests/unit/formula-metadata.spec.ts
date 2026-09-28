import { expect, test } from "@playwright/test";
import {
  FormulaMetadata,
  type FormulaReads,
} from "../../src/features/studio/formulaMetadata";
import type { Definition, RuleSummary } from "../../src/types";

const created = "2026-09-27T00:00:00Z";

function summary(
  id: string,
  version: number,
  name = id,
  createdAt = created,
): RuleSummary {
  return {
    id,
    name,
    description: "",
    kind: "FORMULA",
    revision: version,
    publishedVersion: version,
    createdAt,
    updatedAt: "",
    nodeCount: 2,
    inputCount: 1,
    referenceCount: 0,
  };
}

const definition: Definition = {
  schemaVersion: 1,
  inputs: [
    { name: "amount", type: "NUMBER", required: true, defaultValue: null },
  ],
  nodes: [],
  edges: [],
};

/** Reads that count version downloads per id:version pin. */
function countingReads(catalog: RuleSummary[] = [], createdAt = created) {
  const versionReads: string[] = [];
  const reads: FormulaReads = {
    rule: async (id) => ({
      kind: id.startsWith("rule-") ? "RULE" : "FORMULA",
      name: `Rule ${id}`,
      createdAt,
    }),
    version: async (id, version) => {
      versionReads.push(`${id}:${version}`);
      return { ruleId: id, version, definition, publishedAt: "" };
    },
    search: async () => ({
      items: catalog,
      total: catalog.length,
      offset: 0,
      limit: 8,
    }),
  };
  return { reads, versionReads };
}

const signal = () => new AbortController().signal;

test("a pinned version is downloaded once for every later search, hover and insertion", async () => {
  const { reads, versionReads } = countingReads([summary("tax", 3)]);
  const metadata = new FormulaMetadata(reads);
  expect(
    (await metadata.search("ta", signal())).map((entry) => entry.id),
  ).toEqual(["tax"]);
  await metadata.search("tax", signal());
  await metadata.load("tax", 3, signal());
  await metadata.load("tax", 3, signal(), summary("tax", 3));
  expect(versionReads).toEqual(["tax:3"]);
  await metadata.load("tax", 2, signal());
  expect(versionReads).toEqual(["tax:3", "tax:2"]);
});

test("the cache keeps the most recently used pins within its capacity", async () => {
  const { reads, versionReads } = countingReads();
  const metadata = new FormulaMetadata(reads, 2);
  await metadata.load("a", 1, signal());
  await metadata.load("b", 1, signal());
  await metadata.load("a", 1, signal());
  await metadata.load("c", 1, signal());
  // b was least recently used, so it left the cache; a stayed.
  await metadata.load("a", 1, signal());
  await metadata.load("b", 1, signal());
  expect(versionReads).toEqual(["a:1", "b:1", "c:1", "b:1"]);
});

test("aborted reads and non-Formula rules are never cached", async () => {
  const { reads, versionReads } = countingReads();
  const metadata = new FormulaMetadata(reads);
  const aborted = new AbortController();
  aborted.abort();
  await metadata.load("tax", 1, aborted.signal);
  await metadata.load("tax", 1, signal());
  expect(versionReads).toEqual(["tax:1", "tax:1"]);
  await expect(metadata.load("rule-x", 1, signal())).rejects.toThrow(
    "Only published Formula rules can be called in an expression.",
  );
});

test("a fresh catalog summary renames a cached pin", async () => {
  const { reads } = countingReads();
  const metadata = new FormulaMetadata(reads);
  await metadata.load("tax", 1, signal(), summary("tax", 1, "Old name"));
  const renamed = await metadata.load(
    "tax",
    1,
    signal(),
    summary("tax", 1, "New name"),
  );
  expect(renamed.name).toBe("New name");
  // Hover reads the rule to check its incarnation, so its name is the freshest.
  expect((await metadata.load("tax", 1, signal())).name).toBe("Rule tax");
});

test("a rule created again under a deleted ID is read afresh, and a same-tab deletion forgets it at once", async () => {
  const replaced = "2026-09-28T09:00:00Z";
  const { reads, versionReads } = countingReads([summary("tax", 1)]);
  const metadata = new FormulaMetadata(reads);
  expect(
    (await metadata.load("tax", 1, signal(), summary("tax", 1))).inputs,
  ).toHaveLength(1);
  // A search lists the new incarnation: its version is downloaded again.
  await metadata.load(
    "tax",
    1,
    signal(),
    summary("tax", 1, "New tax", replaced),
  );
  expect(versionReads).toEqual(["tax:1", "tax:1"]);
  // Hover reads the rule itself; the same incarnation reuses the cached inputs.
  const recreated = new FormulaMetadata(countingReads([], replaced).reads);
  await recreated.load(
    "tax",
    1,
    signal(),
    summary("tax", 1, "New tax", replaced),
  );
  expect((await recreated.load("tax", 1, signal())).name).toBe("Rule tax");
  // Re-created as an ordinary rule, the pin is no longer callable.
  const asRule = new FormulaMetadata(countingReads([], replaced).reads);
  await asRule.load("rule-tax", 1, signal(), summary("rule-tax", 1));
  await expect(asRule.load("rule-tax", 1, signal())).rejects.toThrow(
    "Only published Formula rules can be called in an expression.",
  );
  // Deleting in this page drops every version before any later check.
  const forgetting = new FormulaMetadata(reads);
  await forgetting.load("tax", 1, signal(), summary("tax", 1));
  await forgetting.load("tax", 2, signal(), summary("tax", 2));
  await forgetting.load("taxes", 1, signal(), summary("taxes", 1));
  forgetting.forget("tax");
  versionReads.length = 0;
  await forgetting.load("tax", 2, signal(), summary("tax", 2));
  await forgetting.load("taxes", 1, signal(), summary("taxes", 1));
  expect(versionReads).toEqual(["tax:2"]);
});
