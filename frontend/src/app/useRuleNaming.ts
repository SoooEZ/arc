import { useState } from "react";
import { ruleMetadataProblem } from "../domain/limits";
import { isResourceId, suggestedRuleId } from "../domain/resourceIds";

/**
 * A new rule's name, ID and description in a dialog that creates one. The ID
 * follows the name until the user types their own, and clearing it resumes the
 * suggestions (lesson F32): IDs are permanent, so a chosen one must survive
 * later corrections of the name.
 */
export function useRuleNaming(initial: { name: string; description: string }) {
  const [name, setNameText] = useState(initial.name);
  const [id, setIdText] = useState(() => suggestedRuleId(initial.name));
  const [idChosen, setIdChosen] = useState(false);
  const [description, setDescription] = useState(initial.description);
  // The server's own rule, so a long name is refused here, not by a 422.
  const problem = ruleMetadataProblem({ name, description });
  return {
    name,
    id,
    description,
    nameProblem: problem?.field === "name" ? problem.message : null,
    descriptionProblem:
      problem?.field === "description" ? problem.message : null,
    /** Whether the server can be asked to create a rule with these values. */
    complete: !problem && isResourceId(id),
    setName: (next: string) => {
      setNameText(next);
      if (!idChosen) setIdText(suggestedRuleId(next));
    },
    setId: (next: string) => {
      setIdText(next);
      setIdChosen(next !== "");
    },
    setDescription,
  };
}
