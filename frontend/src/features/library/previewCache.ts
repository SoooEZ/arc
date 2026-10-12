import type { Rule, RuleSummary } from "../../types";
import { ruleIncarnation } from "../../domain/ruleIdentity";

/** About two catalog pages: returning to a page or refining a search reuses its previews. */
const capacity = 40;
const previews = new Map<string, Rule>();

type PreviewIdentity = Pick<RuleSummary, "id" | "createdAt" | "revision">;

const previewKey = (rule: PreviewIdentity) =>
  `${ruleIncarnation(rule)}:${rule.revision}`;

/**
 * The full rule behind a card preview. A saved draft gets a new revision, and a
 * rule created again under a deleted ID is another incarnation, so a cached
 * preview never outlives the draft it shows.
 */
export function cachedPreview(rule: PreviewIdentity): Rule | undefined {
  return previews.get(previewKey(rule));
}

/** Stores a loaded preview; the earliest stored previews leave first. */
export function rememberPreview(rule: PreviewIdentity, preview: Rule): void {
  const key = previewKey(rule);
  previews.delete(key);
  previews.set(key, preview);
  for (const oldest of previews.keys()) {
    if (previews.size <= capacity) break;
    previews.delete(oldest);
  }
}

/**
 * Drops every preview of a rule deleted in this page. Its entries could never
 * be served again (a rule created again under the ID is another incarnation),
 * but they held the cache's places until they aged out.
 */
export function forgetPreview(id: string): void {
  // IDs are slugs, so the "@" of the incarnation key ends the ID.
  const prefix = `${id}@`;
  for (const key of [...previews.keys()])
    if (key.startsWith(prefix)) previews.delete(key);
}
