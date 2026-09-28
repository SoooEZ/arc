import { ruleApi } from "../../api/rules";
import type { RuleIdentity } from "../../domain/ruleIdentity";
import type { Page, RuleSummary, Version } from "../../types";
import type { FormulaEntry } from "./formulaCalls";
import { readRuleVersion } from "./pinnedVersions";

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

/** A cached pin remembers which incarnation of the rule it was read from. */
interface CachedFormula extends FormulaEntry {
  createdAt: string;
}

type RuleIdentitySummary = Awaited<ReturnType<FormulaReads["rule"]>>;

/** A read several callers wait for; it is abandoned once none waits. */
interface SharedRead<T> {
  promise: Promise<T>;
  controller: AbortController;
  waiting: number;
}

const abandoned = () =>
  new DOMException("The rule read was abandoned", "AbortError");

/** Waits for `read` until `signal` aborts; the last waiter to leave aborts the read. */
function joinRead<T>(read: SharedRead<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abandoned());
  read.waiting += 1;
  return new Promise<T>((resolve, reject) => {
    let waiting = true;
    const leave = () => {
      if (!waiting) return;
      waiting = false;
      signal.removeEventListener("abort", onAbort);
      read.waiting -= 1;
    };
    const onAbort = () => {
      leave();
      if (read.waiting === 0) read.controller.abort();
      reject(abandoned());
    };
    signal.addEventListener("abort", onAbort, { once: true });
    read.promise.then(
      (value) => {
        leave();
        resolve(value);
      },
      (failure: unknown) => {
        leave();
        reject(failure);
      },
    );
  });
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
  // Hover, completion and insertion may ask about one rule together: they
  // share its identity read instead of each sending one.
  private readonly identityReads = new Map<
    string,
    SharedRead<RuleIdentitySummary>
  >();

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
    const rule = summary ?? (await this.readIdentity(id, signal));
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
    // The pin of this incarnation: another incarnation of the ID has its own.
    const published = await this.reads.version(
      { id, createdAt: rule.createdAt },
      version,
      signal,
    );
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

  private readIdentity(
    id: string,
    signal: AbortSignal,
  ): Promise<RuleIdentitySummary> {
    let read = this.identityReads.get(id);
    if (!read) {
      const controller = new AbortController();
      const shared: SharedRead<RuleIdentitySummary> = {
        controller,
        waiting: 0,
        promise: this.reads.rule(id, controller.signal).finally(() => {
          if (this.identityReads.get(id) === shared)
            this.identityReads.delete(id);
        }),
      };
      this.identityReads.set(id, shared);
      read = shared;
    }
    return joinRead(read, signal);
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
