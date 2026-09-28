import { useEffect, useRef, useState } from "react";

export type ParsedText<Parsed> =
  { valid: true; value: Parsed } | { valid: false; error: string };

/**
 * A field whose text belongs to the user and whose value belongs to the draft
 * (lesson F27). The text is parsed as it is typed; a valid value goes to the
 * draft at once, an invalid one stays in the field with its error and reports
 * itself through `onValidity`. The draft echoes accepted values back, so only a
 * different value from outside replaces the text, and unmounting withdraws any
 * validity report. Keep `format`, `parse` and `same` module-level.
 */
export function useParsedTextBuffer<Stored, Parsed extends Stored>({
  value,
  format,
  parse,
  same,
  onChange,
  onValidity,
}: {
  value: Stored;
  /** The text a stored value shows as. */
  format: (value: Stored) => string;
  /** The value typed text stands for, or why it is not acceptable yet. */
  parse: (raw: string) => ParsedText<Parsed>;
  /** Whether a value arriving from outside is the field's own echo. */
  same: (left: Stored, right: Stored) => boolean;
  onChange: (value: Parsed) => void;
  onValidity: (valid: boolean) => void;
}) {
  const validity = useRef(onValidity);
  validity.current = onValidity;
  useEffect(() => () => validity.current(true), []);
  const [text, setText] = useState(() => format(value));
  const [error, setError] = useState("");
  // The value the text represents: the last one typed here or received from outside.
  const acceptedValue = useRef(value);
  useEffect(() => {
    // Typing echoes its own value back through the draft; rewriting the text then
    // would move the caret. Only a different value from outside replaces the buffer.
    if (same(value, acceptedValue.current)) return;
    acceptedValue.current = value;
    setText(format(value));
    setError("");
    validity.current(true);
  }, [value, format, same]);
  const change = (raw: string) => {
    setText(raw);
    const parsed = parse(raw);
    if (!parsed.valid) {
      setError(parsed.error);
      onValidity(false);
      return;
    }
    acceptedValue.current = parsed.value;
    onChange(parsed.value);
    setError("");
    onValidity(true);
  };
  return { text, error, change };
}
