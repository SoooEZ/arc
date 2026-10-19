import type { DecisionTable } from "../../../types";

/** Rows the inspector shows before Edit table opens the whole grid. */
const previewRows = 5;

/**
 * Columns of each side the narrow inspector shows. The results come last,
 * and a table as wide as its widest row would push them out of view; the
 * dialog shows every column.
 */
const previewConditions = 3;
const previewResults = 2;

/** "…" standing for the columns the preview leaves out. */
function MoreColumns({ count, cell }: { count: number; cell: "th" | "td" }) {
  if (count === 0) return null;
  const Cell = cell;
  return (
    <Cell className="decision-table-preview-narrow" aria-hidden>
      …
    </Cell>
  );
}

/**
 * The table's first rows, read-only, as they read in code. Columns share the
 * width and cut long cells, whose whole text is their tooltip.
 */
export default function TablePreview({ table }: { table: DecisionTable }) {
  const rows = table.rows.slice(0, previewRows);
  const more = table.rows.length - rows.length;
  const conditions = table.conditions.slice(0, previewConditions);
  const results = table.results.slice(0, previewResults);
  const hiddenConditions = table.conditions.length - conditions.length;
  const hiddenResults = table.results.length - results.length;
  return (
    <>
      <div className="decision-table-preview-scroll">
        <table className="decision-table-preview">
          <thead>
            <tr>
              {conditions.map((condition, index) => (
                <th
                  key={`condition-${index}`}
                  scope="col"
                  title={condition.label}
                >
                  {condition.label}
                </th>
              ))}
              <MoreColumns count={hiddenConditions} cell="th" />
              <th className="decision-table-preview-narrow" aria-hidden>
                →
              </th>
              {results.map((result, index) => (
                <th key={`result-${index}`} scope="col" title={result.name}>
                  {result.name || "…"}
                </th>
              ))}
              <MoreColumns count={hiddenResults} cell="th" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              // A read-only snapshot: rows hold no state of their own.
              <tr key={index}>
                {row.when.slice(0, previewConditions).map((cell, column) => (
                  <td key={`when-${column}`} title={cell}>
                    <code>{cell || "…"}</code>
                  </td>
                ))}
                <MoreColumns count={hiddenConditions} cell="td" />
                <td className="decision-table-preview-narrow" aria-hidden>
                  →
                </td>
                {row.then.slice(0, previewResults).map((cell, column) => (
                  <td key={`then-${column}`} title={cell}>
                    <code>{cell || "…"}</code>
                  </td>
                ))}
                <MoreColumns count={hiddenResults} cell="td" />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {more > 0 && (
        <p className="muted-copy">
          {more === 1 ? "1 more row" : `${more} more rows`}
        </p>
      )}
    </>
  );
}
