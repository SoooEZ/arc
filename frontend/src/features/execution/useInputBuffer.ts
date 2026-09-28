import { useState } from "react";
import { shownInputs, type EditedInputs } from "../../domain/executionInputs";

/**
 * The execution input buffer of the Test panel and the API playground: the
 * sample until the user edits it, and the edit only for its `target`.
 */
export function useInputBuffer(target: string, sample: string) {
  const [edited, setEdited] = useState<EditedInputs | null>(null);
  return {
    text: shownInputs(edited, target, sample),
    change: (text: string) => setEdited({ target, text }),
  };
}
