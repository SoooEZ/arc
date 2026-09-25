import { useState } from "react";
import type { Page } from "../types";
import { useAsyncResource } from "./useAsyncResource";

/** One bounded page; changing a search or owner immediately resets the offset. */
export function usePagedResource<T>(
  key: string,
  load: (
    offset: number,
    limit: number,
    signal: AbortSignal,
  ) => Promise<Page<T>>,
  enabled = true,
) {
  const [position, setPosition] = useState({ key, offset: 0 });
  const offset = position.key === key ? position.offset : 0;
  const limit = 20;
  const resource = useAsyncResource(
    JSON.stringify([key, offset]),
    (signal) => load(offset, limit, signal),
    { items: [], total: 0, offset, limit } as Page<T>,
    0,
    enabled,
  );
  return {
    ...resource,
    offset,
    limit,
    setOffset: (next: number) =>
      setPosition({ key, offset: Math.max(0, next) }),
  };
}
