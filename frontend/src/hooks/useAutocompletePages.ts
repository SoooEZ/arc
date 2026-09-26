import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "../api/errors";
import type { Page } from "../types";

interface Pages<T> {
  key: string;
  items: T[];
  total: number;
  nextOffset: number;
  loading: boolean;
  error: string;
}

/** Search owns the page sequence; late pages never join a newer search or owner. */
export function useAutocompletePages<T>(
  owner: string,
  search: string,
  enabled: boolean,
  load: (
    search: string,
    offset: number,
    limit: number,
    signal: AbortSignal,
  ) => Promise<Page<T>>,
  itemKey: (item: T) => string,
) {
  const query = search.trim();
  const key = JSON.stringify([owner, query]);
  const initial: Pages<T> = {
    key,
    items: [],
    total: 0,
    nextOffset: 0,
    loading: enabled,
    error: "",
  };
  const [state, setState] = useState(initial);
  const current = useRef(initial);
  const request = useRef<AbortController | null>(null);
  const latest = useRef({ key, query, enabled, load, itemKey });
  latest.current = { key, query, enabled, load, itemKey };
  const update = useCallback((next: Pages<T>) => {
    current.current = next;
    setState(next);
  }, []);
  const fetchPage = useCallback(
    async (offset: number, expectedKey: string) => {
      const session = latest.current;
      if (!session.enabled || session.key !== expectedKey) return;
      const controller = new AbortController();
      request.current?.abort();
      request.current = controller;
      update({ ...current.current, loading: true, error: "" });
      try {
        const page = await session.load(
          session.query,
          offset,
          20,
          controller.signal,
        );
        if (
          controller.signal.aborted ||
          latest.current.key !== expectedKey ||
          !latest.current.enabled
        )
          return;
        const merged = new Map(
          (offset ? current.current.items : []).map((item) => [
            session.itemKey(item),
            item,
          ]),
        );
        for (const item of page.items) merged.set(session.itemKey(item), item);
        update({
          key: expectedKey,
          items: [...merged.values()],
          total: page.total,
          nextOffset: page.items.length
            ? offset + page.items.length
            : page.total,
          loading: false,
          error: "",
        });
      } catch (failure) {
        if (
          !controller.signal.aborted &&
          latest.current.key === expectedKey &&
          latest.current.enabled
        )
          update({
            ...current.current,
            loading: false,
            error: errorMessage(failure),
          });
      }
    },
    [update],
  );

  useEffect(() => {
    request.current?.abort();
    update({
      key,
      items: [],
      total: 0,
      nextOffset: 0,
      loading: enabled,
      error: "",
    });
    if (!enabled) return;
    const timer = setTimeout(() => void fetchPage(0, key), 180);
    return () => {
      clearTimeout(timer);
      request.current?.abort();
    };
  }, [key, enabled, fetchPage, update]);

  const next = useCallback(() => {
    const page = current.current;
    if (
      !latest.current.enabled ||
      page.key !== latest.current.key ||
      page.loading
    )
      return;
    if (page.error || page.nextOffset < page.total)
      void fetchPage(page.nextOffset, page.key);
  }, [fetchPage]);
  return { ...(state.key === key ? state : initial), next };
}
