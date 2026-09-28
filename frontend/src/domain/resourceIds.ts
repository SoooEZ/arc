import { MAX_RESOURCE_ID_CHARACTERS } from "./limits";

const resourceId = new RegExp(
  `^[a-z][a-z0-9-]{0,${MAX_RESOURCE_ID_CHARACTERS - 1}}$`,
);

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
