import { MAX_RESOURCE_ID_CHARACTERS } from "./limits";

/**
 * The ID's grammar as a regular-expression source, the server's
 * `Identifiers.RESOURCE_ID`: a lowercase letter, then lowercase letters, digits
 * and hyphens, within the length limit. Formula references compose it.
 */
export const resourceIdSyntax = `[a-z][a-z0-9-]{0,${MAX_RESOURCE_ID_CHARACTERS - 1}}`;

const resourceId = new RegExp(`^${resourceIdSyntax}$`);

export const resourceIdGuidance = `Use lowercase letters, digits and hyphens; start with a letter. No spaces, $ or @. Maximum ${MAX_RESOURCE_ID_CHARACTERS} characters.`;

/** Rule and source IDs are API slugs, distinct from expression variable identifiers. */
export function isResourceId(value: string): boolean {
  return resourceId.test(value);
}

export function suggestedRuleId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  if (!slug) return "";
  return (/^[a-z]/.test(slug) ? slug : `rule-${slug}`).slice(
    0,
    MAX_RESOURCE_ID_CHARACTERS,
  );
}
