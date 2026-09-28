import { ruleApi } from "../../api/rules";
import type { Page, RuleSummary, Version } from "../../types";
import type { FormulaEntry } from "./formulaCalls";
import { pinnedRuleVersions, readRuleVersion } from "./pinnedVersions";

/** The reads behind the cache; tests supply their own. */
export interface FormulaReads {
  rule(
    id: string,
    signal: AbortSignal,
  ): Promise<Pick<RuleSummary, "kind" | "name" | "createdAt">>;
  version(id: string, version: number, signal: AbortSignal): Promise<Version>;
  search(query: string, signal: AbortSignal): Promise<Page<RuleSummary>>;
  /** Drops cached versions of a rule created again under its ID, ahead of the next read. */
  forgetVersions?(id: string): void;
}

/** A cached pin remembers which incarnation of the rule it was read from. */
interface CachedFormula extends FormulaEntry {
  createdAt: string;
}

/**
 * Input metadata of published Formula versions for `@` completion, hover and
 * insertion. An id:version pin is immutable while its rule lives, so one
 * bounded cache serves every editor on the page. A deleted ID can be created
 * again with other inputs, so an entry serves only the incarnation it was read
 * from: every load checks the rule's creation time, from the catalog summary
 * when the caller has one and from one rule read otherwise. Only completed
 * reads are kept; an aborted read is dropped.
 */
export class FormulaMetadata {
  private readonly entries = new Map<string, CachedFormula>();

  constructor(
    private readonly reads: FormulaReads,
    private readonly capacity = 64,
  ) {}

  async load(
    id: string,
    version: number,
    signal: AbortSignal,
    summary?: RuleSummary,
  ): Promise<FormulaEntry> {
    const key = `${id}:${version}`;
    const cached = this.entries.get(key);
    const rule = summary ?? (await this.reads.rule(id, signal));
    if (cached && cached.createdAt === rule.createdAt) {
      // A display name can change after publication; a fresh summary wins.
      const current = { ...cached, name: rule.name };
      this.remember(key, current);
      return current;
    }
    if (rule.kind !== "FORMULA")
      throw new Error(
        "Only published Formula rules can be called in an expression.",
      );
    // Another incarnation of the ID: the shared version cache is stale for it too.
    if (cached) this.reads.forgetVersions?.(id);
    const published = await this.reads.version(id, version, signal);
    const formula: CachedFormula = {
      id,
      name: rule.name,
      version,
      inputs: published.definition.inputs,
      createdAt: rule.createdAt,
    };
    if (!signal.aborted) this.remember(key, formula);
    return formula;
  }

  async search(query: string, signal: AbortSignal): Promise<FormulaEntry[]> {
    const page = await this.reads.search(query, signal);
    const results = await Promise.allSettled(
      page.items.flatMap((rule) =>
        rule.publishedVersion === null
          ? []
          : [this.load(rule.id, rule.publishedVersion, signal, rule)],
      ),
    );
    if (signal.aborted) return [];
    return results.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );
  }

  /** Drops every version of a rule deleted in this page, ahead of any later check. */
  forget(id: string): void {
    for (const key of [...this.entries.keys()])
      if (key.startsWith(`${id}:`)) this.entries.delete(key);
  }

  /** Least recently used entries leave first. */
  private remember(key: string, formula: CachedFormula) {
    this.entries.delete(key);
    this.entries.set(key, formula);
    if (this.entries.size <= this.capacity) return;
    const oldest = this.entries.keys().next();
    if (!oldest.done) this.entries.delete(oldest.value);
  }
}

/** Shared by every editor on the page; pinned versions come from the page-wide cache. */
export const formulaMetadata = new FormulaMetadata({
  rule: (id, signal) => ruleApi.get(id, { signal }),
  version: (id, version, signal) => readRuleVersion(id, version, signal),
  forgetVersions: (id) => pinnedRuleVersions.forget(id),
  search: (query, signal) =>
    ruleApi.catalog(
      {
        search: query,
        kind: "FORMULA",
        publishedOnly: true,
        offset: 0,
        limit: 8,
      },
      { signal },
    ),
});
