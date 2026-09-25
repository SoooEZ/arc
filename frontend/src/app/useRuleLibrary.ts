import { useState } from "react";
import { ruleApi } from "../api/rules";
import { usePagedResource } from "../hooks/usePagedResource";
import type { Kind, Rule } from "../types";
export function useRuleLibrary() {
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<Kind | "ALL">("ALL");
  const [revision, setRevision] = useState(0);
  const page = usePagedResource(
    JSON.stringify([search, kind, revision]),
    (offset, limit, signal) =>
      ruleApi.catalog(
        { offset, limit, search, kind: kind === "ALL" ? "" : kind },
        { signal },
      ),
  );
  const load = () => setRevision((value) => value + 1);
  return {
    rules: page.data.items,
    total: page.data.total,
    loading: page.loading,
    loadError: page.error,
    load,
    upsert: (_rule: Rule) => load(),
    search,
    setSearch,
    kind,
    setKind,
    page,
  };
}
