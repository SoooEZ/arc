import { useState, type ClipboardEvent } from "react";

/** Text a single-line name or ID field never accepts: whitespace, `$` and `@`. */
const refusedPaste = /[\s$@]/u;

/**
 * The refuse-and-explain policy of a field that keeps its last accepted value
 * (lessons F28 and F34). A refusal belongs to the value it left in place, so it
 * ends as soon as the value changes, from typing or from outside. Native
 * single-line inputs strip tabs and newlines before `onChange` sees the text,
 * so a paste with them is refused on the paste event itself.
 */
export function useRefusedEdit(value: string) {
  const [refusedAt, setRefusedAt] = useState<string | null>(null);
  return {
    refused: refusedAt === value,
    refuse: () => setRefusedAt(value),
    clear: () => setRefusedAt(null),
    onPaste: (event: ClipboardEvent<HTMLElement>) => {
      if (refusedPaste.test(event.clipboardData.getData("text"))) {
        event.preventDefault();
        setRefusedAt(value);
      }
    },
  };
}
