import type { Diagnostic } from "../../types";

export default function StudioProblems({
  diagnostics,
  readOnly,
  onSelect,
}: {
  diagnostics: Diagnostic[];
  readOnly: boolean;
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
      {!diagnostics.length && (
        <span>
          {readOnly
            ? "Read-only · ⌘/Ctrl Enter to validate"
            : "Tab to indent · ⌘/Ctrl Enter to build · ⌘/Ctrl S to save · comments use //"}
        </span>
      )}
    </div>
  );
}
