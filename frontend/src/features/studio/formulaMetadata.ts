import { ruleApi } from "../../api/rules";
import type { Page, RuleSummary, Version } from "../../types";
import type { FormulaEntry } from "./formulaCalls";

/** The reads behind the cache; tests supply their own. */
export interface FormulaReads {
  rule(
    id: string,
    signal: AbortSignal,
  ): Promise<Pick<RuleSummary, "kind" | "name">>;
  version(id: string, version: number, signal: AbortSignal): Promise<Version>;
  search(query: string, signal: AbortSignal): Promise<Page<RuleSummary>>;
}

/**
 * Input metadata of published Formula versions for `@` completion, hover and
 * insertion. An id:version pin is immutable, so one bounded cache serves every
 * editor on the page. Only completed reads are kept; an aborted read is dropped.
 */
export class FormulaMetadata {
  private readonly entries = new Map<string, FormulaEntry>();

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
    if (cached) {
      // A display name can change after publication; a fresh summary wins.
      const current = summary ? { ...cached, name: summary.name } : cached;
      this.remember(key, current);
      return current;
    }
    const rule = summary ?? (await this.reads.rule(id, signal));
    if (rule.kind !== "FORMULA")
      throw new Error(
        "Only published Formula rules can be called in an expression.",
      );
    const published = await this.reads.version(id, version, signal);
    const formula: FormulaEntry = {
      id,
      name: rule.name,
      version,
      inputs: published.definition.inputs,
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

  /** Least recently used entries leave first. */
  private remember(key: string, formula: FormulaEntry) {
    this.entries.delete(key);
    this.entries.set(key, formula);
    if (this.entries.size <= this.capacity) return;
    const oldest = this.entries.keys().next();
    if (!oldest.done) this.entries.delete(oldest.value);
  }
}

/** Shared by every editor on the page. */
export const formulaMetadata = new FormulaMetadata({
  rule: (id, signal) => ruleApi.get(id, { signal }),
  version: (id, version, signal) => ruleApi.version(id, version, { signal }),
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
