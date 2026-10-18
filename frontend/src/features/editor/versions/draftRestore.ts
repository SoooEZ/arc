import type { Definition } from "../../../types";
import {
  ruleIncarnation,
  type RuleIdentity,
} from "../../../domain/ruleIdentity";

/**
 * Published versions waiting to replace their rule's draft. "Restore to
 * draft" in a version's view leaves the version and requests it here; the
 * draft editor of that rule takes it as it opens and applies it as one edit,
 * which Save keeps and Undo reverts. A request is taken once.
 */
const requested = new Map<
  string,
  { version: number; definition: Definition }
>();

export function requestRestore(
  rule: RuleIdentity,
  version: number,
  definition: Definition,
) {
  requested.set(ruleIncarnation(rule), { version, definition });
}

export function takeRestore(rule: RuleIdentity) {
  const key = ruleIncarnation(rule);
  const restore = requested.get(key) ?? null;
  requested.delete(key);
  return restore;
}
