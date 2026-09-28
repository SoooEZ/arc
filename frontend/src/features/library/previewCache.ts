import type { Rule, RuleSummary } from "../../types";

/** About two catalog pages: returning to a page or refining a search reuses its previews. */
const capacity = 40;
const previews = new Map<string, Rule>();

const previewKey = (rule: Pick<RuleSummary, "id" | "revision">) =>
  `${rule.id}:${rule.revision}`;

/**
 * The full rule behind a card preview. A saved draft gets a new revision, so a
 * cached preview never outlives the draft it shows.
 */
export function cachedPreview(
  rule: Pick<RuleSummary, "id" | "revision">,
): Rule | undefined {
  return previews.get(previewKey(rule));
}

/** Stores a loaded preview; the earliest stored previews leave first. */
export function rememberPreview(
  rule: Pick<RuleSummary, "id" | "revision">,
  preview: Rule,
): void {
  const key = previewKey(rule);
  previews.delete(key);
  previews.set(key, preview);
  for (const oldest of previews.keys()) {
    if (previews.size <= capacity) break;
    previews.delete(oldest);
  }
}
