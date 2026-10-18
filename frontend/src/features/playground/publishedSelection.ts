import type { RuleSummary } from "../../types";
import { sameRule, type RuleIdentity } from "../../domain/ruleIdentity";

/** The sample rule the playground opens with when it is published. */
export const defaultRuleId = "order-pricing";

/**
 * The selection after a catalog page arrives: with nothing selected, the sample
 * rule or else the first published rule; otherwise the page's summary of the
 * selected rule when it is another incarnation of the ID (the rule was deleted
 * and created again) or shows a newer release.
 */
export function selectionAfterCatalogPage(
  current: RuleSummary | null,
  page: RuleSummary[],
): RuleSummary | null {
  if (!current)
    return page.find((rule) => rule.id === defaultRuleId) ?? page[0] ?? null;
  const listed = page.find((rule) => rule.id === current.id);
  if (!listed) return current;
  if (!sameRule(listed, current)) return listed;
  const newer =
    (listed.publishedVersion ?? 0) > (current.publishedVersion ?? 0);
  return newer ? listed : current;
}

/** A release learned from one rule incarnation's version history. */
export interface KnownRelease extends RuleIdentity {
  version: number;
}

export const noRelease: KnownRelease = { id: "", createdAt: "", version: 0 };

/** The newest release known for the selected rule; another incarnation starts over. */
export function newestKnownRelease(
  current: KnownRelease,
  rule: RuleIdentity,
  version: number,
): KnownRelease {
  if (sameRule(current, rule) && current.version >= version) return current;
  return { id: rule.id, createdAt: rule.createdAt, version };
}

/** The version a known release contributes to `rule`, or 0 for another incarnation. */
export function knownVersion(
  release: KnownRelease,
  rule: RuleIdentity | null,
): number {
  return rule && sameRule(release, rule) ? release.version : 0;
}
