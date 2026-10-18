import { useState } from "react";

/** Fields that open empty on a new source, so their problems wait for the user. */
export type TouchedField = "name" | "url";

interface Feedback {
  /** The open document's selection; another selection starts afresh. */
  selection: number;
  touched: ReadonlySet<TouchedField>;
  /** Cells holding text the server would refuse, such as a default "12a". */
  invalid: ReadonlySet<string>;
}

const fresh = (selection: number): Feedback => ({
  selection,
  touched: new Set(),
  invalid: new Set(),
});

/**
 * What the source form shows about its fields. A field's problem shows once
 * the user has changed or left it, so a new source opens without errors while
 * Create stays disabled with its reason; a cell's invalid text blocks saving
 * until it is fixed, since only valid values reach the buffers.
 */
export function useFieldFeedback(selection: number) {
  const [state, setState] = useState(() => fresh(selection));
  const current = state.selection === selection ? state : fresh(selection);
  const update = (change: (feedback: Feedback) => Feedback) =>
    setState((previous) =>
      change(previous.selection === selection ? previous : fresh(selection)),
    );
  return {
    touched: (field: TouchedField) => current.touched.has(field),
    touch: (field: TouchedField) => {
      if (current.touched.has(field)) return;
      update((feedback) => ({
        ...feedback,
        touched: new Set([...feedback.touched, field]),
      }));
    },
    hasInvalidCells: current.invalid.size > 0,
    cellValidity: (cell: string, valid: boolean) =>
      update((feedback) => {
        if (feedback.invalid.has(cell) !== valid) return feedback;
        const invalid = new Set(feedback.invalid);
        if (valid) invalid.delete(cell);
        else invalid.add(cell);
        return { ...feedback, invalid };
      }),
  };
}
