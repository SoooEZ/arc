import type { Page } from "../types";
import { searchDelayMs, useDebouncedValue } from "./useDebouncedValue";
import { usePagedResource } from "./usePagedResource";

interface SearchOptions {
  /** Other identity of the page, e.g. a kind filter or a catalog revision. */
  key?: string;
  enabled?: boolean;
  /** Changing it reloads the current page without resetting the offset. */
  refresh?: number | string;
  /** Keep the shown page while the next one loads. */
  keepPrevious?: boolean;
}

/**
 * A paged catalog search: the query applies once typing pauses (searchDelayMs),
 * a settled query starts at the first page, and `searching` says that the
 * shown page answers an older query. Every catalog search (library, playground,
 * sources, Code studio's Reuse pane) waits the same way, so typing "discount"
 * sends one request instead of one per key.
 */
export function usePagedSearch<T>(
  search: string,
  load: (
    query: string,
    offset: number,
    limit: number,
    signal: AbortSignal,
  ) => Promise<Page<T>>,
  {
    key = "",
    enabled = true,
    refresh = 0,
    keepPrevious = false,
  }: SearchOptions = {},
) {
  const query = useDebouncedValue(search, searchDelayMs);
  const page = usePagedResource(
    JSON.stringify([query, key]),
    enabled
      ? (offset, limit, signal) => load(query, offset, limit, signal)
      : null,
    { refresh, keepPrevious },
  );
  return { ...page, query, searching: query !== search };
}
