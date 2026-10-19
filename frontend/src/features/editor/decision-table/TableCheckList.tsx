import { useMemo } from "react";
import {
  checkTable,
  hintText,
  type TableHint,
} from "../../../domain/decisionTableCheck";
import { listed } from "../../../domain/text";
import type { DecisionTable } from "../../../types";

/** Hints listed in full; the rest are named by their rows. */
const listedHints = 8;

function hintRows(hint: TableHint): string {
  if (hint.kind === "unreachable") return `row ${hint.row}`;
  if (hint.kind === "overlap") return `rows ${hint.rows.join(" and ")}`;
  return "uncovered values";
}

/**
 * The table check's hints, live as the table changes. They are advice: the
 * server checks a run, and a hint never blocks saving or publishing.
 */
export default function TableCheckList({ table }: { table: DecisionTable }) {
  const check = useMemo(() => checkTable(table), [table]);
  if (check.skipped)
    return <p className="decision-table-check-note">{check.skipped}</p>;
  const policy = table.hitPolicy ?? "FIRST";
  return (
    <div className="decision-table-check" aria-live="polite">
      {check.hints.length ? (
        <ul>
          {check.hints.slice(0, listedHints).map((hint) => (
            <li key={hintText(hint)}>{hintText(hint)}</li>
          ))}
          {check.hints.length > listedHints && (
            <li>
              {check.hints.length - listedHints} more:{" "}
              {listed(
                check.hints
                  .slice(listedHints)
                  .map((hint) => hintRows(hint))
                  .filter(Boolean)
                  .slice(0, 12),
              )}
              .
            </li>
          )}
        </ul>
      ) : (
        <p className="decision-table-check-ok">
          {policy === "UNIQUE"
            ? "No two rows match the same values, and every value matches a row."
            : "Every row can match, and every value matches a row."}
        </p>
      )}
      {check.incomplete && (
        <p className="decision-table-check-note">
          The check stopped early: this table has too many combinations to check
          here.
        </p>
      )}
    </div>
  );
}
