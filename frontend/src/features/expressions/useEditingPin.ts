import { useState } from "react";

/**
 * Keeps the editor the user is working in (lesson F13). A control infers its
 * editor from the stored value until the user edits through it; from then on
 * partial values such as "", "-" or "[1, 2," must not swap the control. The pin
 * belongs to the value the control produced: when the value changes elsewhere
 * (node code, the node edit dialog), the control infers its editor again.
 * An absent value and "" are the same edit, because callers store either.
 */
export function useEditingPin<T>(
  value: string | null | undefined,
): [T | null, (state: T, producedValue: string | null | undefined) => void] {
  const [pin, setPin] = useState<{ state: T; value: string } | null>(null);
  const current =
    pin !== null && pin.value === (value ?? "") ? pin.state : null;
  const keep = (state: T, producedValue: string | null | undefined) =>
    setPin({ state, value: producedValue ?? "" });
  return [current, keep];
}
