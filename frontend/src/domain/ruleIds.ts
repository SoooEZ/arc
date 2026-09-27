const ruleId = /^[a-z][a-z0-9-]{0,79}$/;

export const ruleIdGuidance =
  "Use lowercase letters, digits and hyphens; start with a letter. No spaces, $ or @. Maximum 80 characters.";

/** Rule IDs are API slugs, distinct from expression variable identifiers. */
export function isRuleId(value: string): boolean {
  return ruleId.test(value);
}

export function suggestedRuleId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  if (!slug) return "";
  return (/^[a-z]/.test(slug) ? slug : `rule-${slug}`).slice(0, 80);
}
