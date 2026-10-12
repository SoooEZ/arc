import type { Diagnostic } from "../../types";

/**
 * The code's build problems, each a jump to its line, under the code and the
 * JSON alike: a build started from the JSON view reports here too.
 */
export default function StudioProblems({
  diagnostics,
  hint,
  onSelect,
}: {
  diagnostics: Diagnostic[];
  /** What the shown editor offers while the code has no problems. */
  hint: string;
  onSelect: (line: number, column: number) => void;
}) {
  return (
    <div
      className={`studio-problems ${diagnostics.length ? "has-errors" : ""}`}
    >
      <strong>
        {diagnostics.length
          ? `${diagnostics.length} build problem`
          : "ARC script"}
      </strong>
      {diagnostics.map((diagnostic, index) => (
        <button
          key={index}
          onClick={() => onSelect(diagnostic.line, diagnostic.column)}
        >
          Ln {diagnostic.line}:{diagnostic.column} · {diagnostic.message}
        </button>
      ))}
      {!diagnostics.length && <span>{hint}</span>}
    </div>
  );
}
