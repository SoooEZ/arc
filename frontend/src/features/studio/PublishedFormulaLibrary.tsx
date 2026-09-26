import { useEffect, useRef, useState } from "react";
import { Alert, Button, TextField, Tooltip } from "@mui/material";
import { ruleApi } from "../../api/rules";
import { errorMessage } from "../../api/errors";
import { useAutocompletePages } from "../../hooks/useAutocompletePages";
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
  const list = useRef<HTMLDivElement>(null);
  const catalog = useAutocompletePages(
    "published-formulas",
    search,
    true,
    (query, offset, limit, signal) =>
      ruleApi.catalog(
        { offset, limit, search: query, kind: "FORMULA", publishedOnly: true },
        { signal },
      ),
    (rule) => rule.id,
  );
  useEffect(() => {
    list.current?.scrollTo({ top: 0 });
  }, [search.trim()]);
  useEffect(() => {
    pending.current?.abort();
    setBusy("");
    setError("");
    return () => pending.current?.abort();
  }, [search, readOnly]);
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
      <div
        ref={list}
        className="published-formula-results"
        role="region"
        aria-label="Published formulas"
        aria-busy={catalog.loading}
        tabIndex={0}
        onScroll={(event) => {
          const element = event.currentTarget;
          const remaining =
            element.scrollHeight - element.scrollTop - element.clientHeight;
          if (remaining < 96 && !catalog.error) catalog.next();
        }}
      >
        {catalog.items.map((rule) => (
          <Tooltip
            key={rule.id}
            describeChild
            title={`${rule.id} · version ${rule.publishedVersion} · ${rule.inputCount} ${rule.inputCount === 1 ? "parameter" : "parameters"}`}
          >
            <span className="published-formula-item">
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
                <span aria-hidden="true">+</span>
              </button>
            </span>
          </Tooltip>
        ))}
        <p className="studio-hint" role="status">
          {catalog.loading
            ? "Loading formulas…"
            : catalog.items.length
              ? `${catalog.items.length} of ${catalog.total} ${catalog.total === 1 ? "formula" : "formulas"}`
              : !catalog.error && "No matching published formulas."}
        </p>
        {catalog.error ? (
          <Alert
            severity="error"
            action={<Button onClick={catalog.next}>Retry</Button>}
          >
            {catalog.error}
          </Alert>
        ) : (
          catalog.nextOffset < catalog.total && (
            <Button disabled={catalog.loading} onClick={catalog.next}>
              Load more formulas
            </Button>
          )
        )}
      </div>
      {error && <Alert severity="error">{error}</Alert>}
    </>
  );
}
