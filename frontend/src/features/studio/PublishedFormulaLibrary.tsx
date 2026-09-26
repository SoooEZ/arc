import { useEffect, useRef, useState } from "react";
import { Alert, TextField, Tooltip } from "@mui/material";
import { ruleApi } from "../../api/rules";
import { errorMessage } from "../../api/errors";
import { usePagedResource } from "../../hooks/usePagedResource";
import CatalogPagination from "../../components/CatalogPagination";
import type { RuleSummary } from "../../types";

export default function PublishedFormulaLibrary({
  readOnly,
  onInsert,
}: {
  readOnly: boolean;
  onInsert: (rule: RuleSummary, signal?: AbortSignal) => Promise<void>;
}) {
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const pending = useRef<AbortController | null>(null);
  const catalog = usePagedResource(search, (offset, limit, signal) =>
    ruleApi.catalog(
      { offset, limit, search, kind: "FORMULA", publishedOnly: true },
      { signal },
    ),
  );
  useEffect(() => {
    pending.current?.abort();
    setBusy("");
    setError("");
    return () => pending.current?.abort();
  }, [search, catalog.offset, readOnly]);
  const insert = async (rule: RuleSummary) => {
    if (readOnly) return;
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setBusy(rule.id);
    setError("");
    try {
      await onInsert(rule, controller.signal);
    } catch (failure) {
      if (!controller.signal.aborted) setError(errorMessage(failure));
    } finally {
      if (!controller.signal.aborted) setBusy("");
    }
  };
  return (
    <>
      <TextField
        label="Find published formula"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <p className="studio-hint">
        Insert a formula call pinned to its published version. Tab moves between
        arguments.
      </p>
      {catalog.data.items.map((rule) => (
        <Tooltip
          key={rule.id}
          describeChild
          title={`${rule.id} · version ${rule.publishedVersion} · ${rule.inputCount} parameters`}
        >
          <button
            className="snippet-card"
            disabled={readOnly || busy === rule.id}
            onClick={() => void insert(rule)}
          >
            <span>
              {rule.name}
              <small>
                @{rule.id}:{rule.publishedVersion}
                {busy === rule.id ? " · loading…" : ""}
              </small>
            </span>
            <span>+</span>
          </button>
        </Tooltip>
      ))}
      <CatalogPagination
        label="Published formulas"
        offset={catalog.offset}
        limit={catalog.limit}
        total={catalog.data.total}
        loading={catalog.loading}
        onPage={catalog.setOffset}
      />
      {(error || catalog.error) && (
        <Alert severity="error">{error || catalog.error}</Alert>
      )}
    </>
  );
}
