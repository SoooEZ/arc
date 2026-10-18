import { useState } from "react";

/**
 * A table cell that renames its row when it loses focus or on Enter. The typed
 * text stays here until then; a name that `problem` refuses stays too, marked,
 * with the reason as its title. Lookup keys and secret header names use it;
 * the parameter table's NameCell refuses each keystroke instead (lesson F28).
 */
export default function RenameCell({
  name,
  label,
  className,
  problem,
  disabled,
  spellCheck,
  onRename,
}: {
  name: string;
  label: string;
  className: string;
  /** Why `text` cannot become the name, or null when it can. */
  problem: (text: string) => string | null;
  disabled: boolean;
  spellCheck?: boolean;
  onRename: (name: string) => void;
}) {
  const [text, setText] = useState(name);
  const refusal = problem(text);
  return (
    <input
      className={`table-cell-input ${className} ${refusal ? "table-cell-invalid" : ""}`}
      aria-label={label}
      aria-invalid={!!refusal}
      title={refusal ?? undefined}
      value={text}
      disabled={disabled}
      spellCheck={spellCheck}
      onChange={(event) => setText(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
      onBlur={() => {
        if (text !== name && !refusal) onRename(text);
      }}
    />
  );
}
