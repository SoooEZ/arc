import { ruleApi } from "../../api/rules";
import type { RuleIdentity } from "../../domain/ruleIdentity";
import type { Page, RuleSummary, Version } from "../../types";
import type { FormulaEntry } from "./formulaCalls";
import { PinnedReads } from "../../app/pinnedReads";
import { readRuleVersion } from "../../app/pinnedVersions";

/** The reads behind the cache; tests supply their own. */
export interface FormulaReads {
  rule(
    id: string,
    signal: AbortSignal,
  ): Promise<Pick<RuleSummary, "kind" | "name" | "createdAt">>;
  /** The pinned version of one incarnation of the rule (the page-wide cache keys by it). */
  version(
    rule: RuleIdentity,
    version: number,
    signal: AbortSignal,
  ): Promise<Version>;
  search(query: string, signal: AbortSignal): Promise<Page<RuleSummary>>;
}

type RuleIdentitySummary = Awaited<ReturnType<FormulaReads["rule"]>>;

/**
 * Input metadata of published Formula versions for `@` completion, hover and
 * insertion. An id:version pin is immutable while its rule lives, so one
 * bounded cache serves every editor on the page. A deleted ID can be created
 * again with other inputs, so an entry serves only the incarnation it was read
 * from: its key carries the rule's creation time, which every load learns from
 * the catalog summary when the caller has one and from one rule read otherwise.
 * Both reads are shared while they run (PinnedReads): a caller that has left
 * starts nothing, and one that arrives as the last caller leaves gets a fresh
 * read rather than the abandoned one.
 */
export class FormulaMetadata {
  // Hover, completion and insertion may ask about one rule together: they
  // share its identity read. An identity can change, so none is kept.
  private readonly identities = new PinnedReads<RuleIdentitySummary>(0);
  private readonly formulas: PinnedReads<FormulaEntry>;

  constructor(
    private readonly reads: FormulaReads,
    capacity = 64,
  ) {
    this.formulas = new PinnedReads<FormulaEntry>(capacity);
  }

  async load(
    id: string,
    version: number,
    signal: AbortSignal,
    summary?: RuleSummary,
  ): Promise<FormulaEntry> {
    const rule =
      summary ??
      (await this.identities.load(
        `${id}:identity`,
        (shared) => this.reads.rule(id, shared),
        signal,
      ));
    if (rule.kind !== "FORMULA")
      throw new Error(
        "Only published Formula rules can be called in an expression.",
      );
    // The pin of this incarnation: another incarnation of the ID has its own.
    const formula = await this.formulas.load(
      `${id}:${version}:${rule.createdAt}`,
      async (shared) => {
        const published = await this.reads.version(
          { id, createdAt: rule.createdAt },
          version,
          shared,
        );
        return {
          id,
          name: rule.name,
          version,
          inputs: published.definition.inputs,
        };
      },
      signal,
    );
    // A display name can change after publication; the freshest read wins.
    return { ...formula, name: rule.name };
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
    this.formulas.forget(id);
    this.identities.forget(id);
  }
}

/** Shared by every editor on the page; pinned versions come from the page-wide cache. */
export const formulaMetadata = new FormulaMetadata({
  rule: (id, signal) => ruleApi.get(id, { signal }),
  version: (rule, version, signal) => readRuleVersion(rule, version, signal),
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
