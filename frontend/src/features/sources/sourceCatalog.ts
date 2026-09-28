import type { Page, SourceSummary } from "../../types";

/** A source saved in this session and the catalog revision its save requested. */
export interface SavedSource {
  summary: SourceSummary;
  revision: number;
}

/** Newest first; one entry per source, at most one catalog page of them. */
export function rememberSavedSource(
  saved: SavedSource[],
  entry: SavedSource,
  limit: number,
): SavedSource[] {
  return [
    entry,
    ...saved.filter((item) => item.summary.id !== entry.summary.id),
  ].slice(0, limit);
}

/**
 * The rows and total shown for one catalog page. A summary saved in this
 * session replaces an older row of the same source. Until a catalog read
 * issued after a save succeeds (`listedRevision` reaches the save's revision),
 * the saved source is also shown first on the first page; that read then
 * decides whether it belongs to the page, so the client never repeats the
 * server's search or ordering.
 */
export function catalogRows(
  page: Page<SourceSummary>,
  saved: SavedSource[],
  listedRevision: number,
): { rows: SourceSummary[]; total: number } {
  const rows = page.items.map(
    (row) =>
      saved.find(
        ({ summary }) => summary.id === row.id && summary.version > row.version,
      )?.summary ?? row,
  );
  if (page.offset !== 0) return { rows, total: page.total };
  const awaitingListing = saved
    .filter(
      ({ summary, revision }) =>
        revision > listedRevision && !rows.some((row) => row.id === summary.id),
    )
    .map(({ summary }) => summary);
  return {
    rows: [...awaitingListing, ...rows].slice(0, page.limit),
    total: page.total + awaitingListing.length,
  };
}
