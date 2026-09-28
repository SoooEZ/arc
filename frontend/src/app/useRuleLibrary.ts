import { useEffect, useState } from "react";
import { ruleApi } from "../api/rules";
import { searchDelayMs, useDebouncedValue } from "../hooks/useDebouncedValue";
import { usePagedResource } from "../hooks/usePagedResource";
import type { Kind } from "../types";

/**
 * The library catalog page. Searches wait for typing to pause and keep the
 * shown cards until the next page arrives. A saved or created rule marks the
 * page stale; it reloads, at the same offset, once the library is shown again.
 */
export function useRuleLibrary(visible: boolean) {
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<Kind | "ALL">("ALL");
  const query = useDebouncedValue(search, searchDelayMs);
  const [refresh, setRefresh] = useState(0);
  const [stale, setStale] = useState(false);
  const page = usePagedResource(
    JSON.stringify([query, kind]),
    (offset, limit, signal) =>
      ruleApi.catalog(
        { offset, limit, search: query, kind: kind === "ALL" ? "" : kind },
        { signal },
      ),
    true,
    { refresh, keepPrevious: true },
  );
  useEffect(() => {
    if (!visible || !stale) return;
    setStale(false);
    setRefresh((value) => value + 1);
  }, [visible, stale]);
  return {
    rules: page.data.items,
    total: page.data.total,
    loading: page.loading,
    loadError: page.error,
    retry: () => setRefresh((value) => value + 1),
    /** A rule changed elsewhere; reload when the library is next shown. */
    markChanged: () => setStale(true),
    search,
    setSearch,
    kind,
    setKind,
    page,
  };
}
