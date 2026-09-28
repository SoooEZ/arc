import { ruleApi } from "../../api/rules";
import { sourceApi } from "../../api/sources";
import { ruleIncarnation, type RuleIdentity } from "../../domain/ruleIdentity";
import type { DataSource, Version } from "../../types";
import { PinnedReads } from "./pinnedReads";

/**
 * Pinned rule versions read by Reference cards and Formula metadata. A rule
 * can be deleted and created again under its ID with other inputs, so a pin
 * is cached for the incarnation it was read from: the key carries the rule's
 * creation time, and a deletion in this page forgets the ID outright.
 */
export const pinnedRuleVersions = new PinnedReads<Version>();

/** Pinned source versions read by every value-provider card; sources are never deleted. */
export const pinnedSourceVersions = new PinnedReads<DataSource>();

/** The cache key of a pinned rule version: "id:" first, so `forget(id)` finds it. */
function pinnedRuleVersionKey(rule: RuleIdentity, version: number): string {
  return `${rule.id}:${version}:${ruleIncarnation(rule)}`;
}

export function readRuleVersion(
  rule: RuleIdentity,
  version: number,
  signal?: AbortSignal,
) {
  return pinnedRuleVersions.load(
    pinnedRuleVersionKey(rule, version),
    (shared) => ruleApi.version(rule.id, version, { signal: shared }),
    signal,
  );
}

export function readSourceVersion(
  id: string,
  version: number,
  signal?: AbortSignal,
) {
  return pinnedSourceVersions.load(
    `${id}:${version}`,
    (shared) => sourceApi.source(id, version, { signal: shared }),
    signal,
  );
}
