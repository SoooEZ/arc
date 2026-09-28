import { useEffect, useState } from "react";
import type { Page } from "../types";
import { useAsyncResource } from "./useAsyncResource";

interface PagedOptions {
  /** Changing it reloads the current page without resetting the offset. */
  refresh?: number | string;
  /** Keep the shown page while the next one loads. */
  keepPrevious?: boolean;
}

/** Offset of the last page that holds any of `total` items. */
export function lastPageOffset(total: number, limit: number): number {
  return total > 0 ? Math.floor((total - 1) / limit) * limit : 0;
}

/** One bounded page; changing a search or owner immediately resets the offset. */
export function usePagedResource<T>(
  key: string,
  load: (
    offset: number,
    limit: number,
    signal: AbortSignal,
  ) => Promise<Page<T>>,
  enabled = true,
  { refresh = 0, keepPrevious = false }: PagedOptions = {},
) {
  const [position, setPosition] = useState({ key, offset: 0 });
  // A new key starts at the first page, and stays there when the key comes back (React's
  // adjust-state-while-rendering pattern); the derivation covers the render the reset lands in.
  if (position.key !== key) setPosition({ key, offset: 0 });
  const offset = position.key === key ? position.offset : 0;
  const limit = 20;
  const emptyPage: Page<T> = { items: [], total: 0, offset, limit };
  const resource = useAsyncResource(
    JSON.stringify([key, offset, refresh]),
    (signal) => load(offset, limit, signal),
    emptyPage,
    0,
    enabled,
    { keepPrevious },
  );
  const settledTotal =
    resource.loading || resource.error ? null : resource.data.total;
  useEffect(() => {
    // A refreshed catalog can end before the shown page, e.g. after a rename leaves a search.
    if (settledTotal === null) return;
    const last = lastPageOffset(settledTotal, limit);
    if (offset > last) setPosition({ key, offset: last });
  }, [key, offset, settledTotal]);
  return {
    ...resource,
    offset,
    limit,
    setOffset: (next: number) =>
      setPosition({ key, offset: Math.max(0, next) }),
  };
}
