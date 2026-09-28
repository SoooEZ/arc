/** What identifies one rule for its whole life: the ID and the moment it was created. */
export interface RuleIdentity {
  id: string;
  createdAt: string;
}

/**
 * Whether two records describe the same rule. A deleted rule's ID can be
 * created again, and the new rule restarts its published versions, so the ID
 * alone is not an identity; the creation time changes with every incarnation.
 */
export function sameRule(a: RuleIdentity, b: RuleIdentity): boolean {
  return a.id === b.id && a.createdAt === b.createdAt;
}

/** A key that differs for every incarnation of an ID. */
export function ruleIncarnation(rule: RuleIdentity): string {
  return `${rule.id}@${rule.createdAt}`;
}
