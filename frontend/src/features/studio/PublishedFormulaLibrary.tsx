import { useEffect, useRef, useState, type MouseEvent } from "react";
import { Alert, Button, TextField, Tooltip } from "@mui/material";
import { ruleApi } from "../../api/rules";
import { useAutocompletePages } from "../../hooks/useAutocompletePages";
import type { RuleSummary } from "../../types";
import { useLibraryInsertion } from "./useLibraryInsertion";

function catalogStatus(catalog: {
  loading: boolean;
  error: string;
  items: unknown[];
  total: number;
}): string {
  if (catalog.loading) return "Loading formulas…";
  if (catalog.items.length)
    return `${catalog.items.length} of ${catalog.total} ${catalog.total === 1 ? "formula" : "formulas"}`;
  return catalog.error ? "" : "No matching published formulas.";
}

export default function PublishedFormulaLibrary({
  readOnly,
  onInsert,
}: {
  readOnly: boolean;
  onInsert: (rule: RuleSummary, signal?: AbortSignal) => Promise<void>;
}) {
  const [search, setSearch] = useState("");
  const insertion = useLibraryInsertion();
  const { cancel } = insertion;
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
  // A new search or read-only switch abandons the pending insertion.
  useEffect(() => {
    cancel();
  }, [search, readOnly, cancel]);
  const insert = (event: MouseEvent<HTMLButtonElement>, rule: RuleSummary) => {
    if (readOnly) return;
    insertion.onCardClick(event, rule.id, (signal) => onInsert(rule, signal));
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
                disabled={readOnly || insertion.busy === rule.id}
                onClick={(event) => insert(event, rule)}
              >
                <span>
                  {rule.name}
                  <small>
                    @{rule.id}:{rule.publishedVersion}
                    {insertion.busy === rule.id ? " · loading…" : ""}
                  </small>
                </span>
                <span aria-hidden="true">+</span>
              </button>
            </span>
          </Tooltip>
        ))}
        <p className="studio-hint" role="status">
          {catalogStatus(catalog)}
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
      {insertion.error && <Alert severity="error">{insertion.error}</Alert>}
    </>
  );
}
