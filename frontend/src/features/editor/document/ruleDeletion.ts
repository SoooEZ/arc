import { errorDetails, errorMessage } from "../../../api/errors";
import { pagePath } from "../../../app/routing";
import type { Rule } from "../../../types";
import type { CommandRunner } from "./commandRunner";

/** Why the server kept a rule: its message and, for a refused deletion, every caller. */
export interface DeletionRefusal {
  message: string;
  callers: string[];
}

/** A deletion the command lock declined: nothing was sent, so nothing was deleted. */
export const deletionDeclined: DeletionRefusal = {
  message:
    "The rule was not deleted: another command is still running. Wait for it to finish, then try again.",
  callers: [],
};

interface Collaborators {
  rule: Pick<Rule, "id" | "revision">;
  runner: CommandRunner;
  /** Deletes the rule at the revision the editor read (`ruleApi.delete`). */
  remove: (id: string, revision: number) => Promise<void>;
  /** Told once the rule is deleted, before the editor leaves for the library. */
  onDeleted?: (id: string) => void;
  notify: (message: string) => void;
  onDirty: (dirty: boolean) => void;
  navigate: (path: string) => void;
}

/**
 * Deletes the rule and leaves for the library. Unsaved changes go with the
 * rule, so leaving does not ask about them. Resolves to why the rule was kept,
 * or null once it is deleted; a start the lock declines is a refusal as well,
 * never a silent success. A deletion cannot be recalled once sent, so it
 * outlives the editor session: the request carries no session signal, and its
 * outcome is reported through the workspace even after the user has left.
 */
export async function deleteRuleCommand({
  rule,
  runner,
  remove,
  onDeleted,
  notify,
  onDirty,
  navigate,
}: Collaborators): Promise<DeletionRefusal | null> {
  let refusal: DeletionRefusal | null = null;
  const ran = await runner.run("delete", async (signal) => {
    try {
      await remove(rule.id, rule.revision);
    } catch (failure) {
      refusal = {
        message: errorMessage(failure),
        callers: errorDetails(failure),
      };
      if (signal.aborted)
        notify(`Rule ${rule.id} was not deleted: ${refusal.message}`);
      return;
    }
    onDeleted?.(rule.id);
    notify(`Rule ${rule.id} deleted`);
    if (signal.aborted) return;
    onDirty(false);
    navigate(pagePath("library"));
  });
  return ran ? refusal : deletionDeclined;
}
