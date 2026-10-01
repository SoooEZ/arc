import type { RuleSummary } from "../../types";

/**
 * The library's order: the most recently updated rule first, compared as
 * instants. The server writes as many fraction digits as it has, so as text
 * "…:00.5Z" sorted before "…:00.25Z".
 */
export function newestFirst(rules: readonly RuleSummary[]): RuleSummary[] {
  return [...rules].sort(
    (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
  );
}
