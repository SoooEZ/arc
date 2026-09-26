import { useEffect, useRef, useState } from "react";
import { Alert, TextField } from "@mui/material";
import { Braces, GitBranch, Puzzle } from "lucide-react";
import { usePagedResource } from "../../hooks/usePagedResource";
import CatalogPagination from "../../components/CatalogPagination";
import FunctionLibrary from "./FunctionLibrary";
import { ruleApi } from "../../api/rules";
import { errorMessage } from "../../api/errors";
import type { Definition, FunctionEntry, RuleSummary } from "../../types";
import { modules, referenceSnippet } from "./snippets";

type Pane = "functions" | "modules" | "reuse";
const panes: Pane[] = ["functions", "modules", "reuse"];

export default function StudioLibrary({
  ruleId,
  definition,
  functions,
  catalogError,
  readOnly,
  onInsert,
  onInsertFormula,
}: {
  ruleId: string;
  definition: Definition;
  functions: FunctionEntry[];
  catalogError: string;
  readOnly: boolean;
  onInsert: (snippet: string, atEnd?: boolean) => void;
  onInsertFormula: (rule: RuleSummary, signal?: AbortSignal) => Promise<void>;
}) {
  const [search, setSearch] = useState("");
  const [pane, setPane] = useState<Pane>("functions");
  const catalog = usePagedResource(
    search,
    (offset, limit, signal) =>
      ruleApi.catalog(
        { offset, limit, search, publishedOnly: true },
        { signal },
      ),
    pane === "reuse",
  );
  const [error, setError] = useState("");
  const pending = useRef(new Set<AbortController>());
  const latest = useRef({ definition, readOnly, onInsert });
  latest.current = { definition, readOnly, onInsert };
  useEffect(
    () => () => {
      for (const request of pending.current) request.abort();
    },
    [],
  );

  const reuse = async (rule: RuleSummary) => {
    if (readOnly || rule.publishedVersion === null) return;
    const request = new AbortController();
    pending.current.add(request);
    setError("");
    try {
      const version = await ruleApi.version(rule.id, rule.publishedVersion, {
        signal: request.signal,
      });
      if (request.signal.aborted || latest.current.readOnly) return;
      latest.current.onInsert(
        referenceSnippet(
          rule,
          version,
          latest.current.definition,
          `reuse-${rule.id}-${Math.random().toString(36).slice(2, 6)}`,
        ),
        true,
      );
    } catch (failure) {
      if (!request.signal.aborted) setError(errorMessage(failure));
    } finally {
      pending.current.delete(request);
    }
  };

  return (
    <aside className="studio-library">
      <div className="studio-library-title">
        <Puzzle size={17} />
        <strong>Build with blocks</strong>
      </div>
      <div className="studio-tabs">
        {panes.map((item) => (
          <button
            key={item}
            className={pane === item ? "active" : ""}
            onClick={() => setPane(item)}
          >
            {item}
          </button>
        ))}
      </div>
      {pane === "functions" && (
        <FunctionLibrary
          functions={functions}
          readOnly={readOnly}
          onInsert={onInsert}
          onInsertFormula={onInsertFormula}
        />
      )}
      {pane === "modules" && (
        <>
          <p className="studio-hint">
            Insert nodes at the end of your script, then connect their next /
            true / false / case / default targets. Input declarations go inside
            inputs.
          </p>
          {modules.map((module) => (
            <button
              className="snippet-card"
              key={module.name}
              disabled={readOnly}
              onClick={() =>
                onInsert(module.snippet, module.placement === "end")
              }
            >
              <Braces size={17} />
              <span>{module.name}</span>
              <span>+</span>
            </button>
          ))}
        </>
      )}
      {pane === "reuse" && (
        <>
          <p className="studio-hint">
            Insert a published rule or formula as a versioned module. Required
            input bindings are included.
          </p>
          <TextField
            label="Find reusable rule"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          {catalog.data.items
            .filter((rule) => rule.publishedVersion && rule.id !== ruleId)
            .map((rule) => (
              <button
                key={rule.id}
                className="snippet-card"
                disabled={readOnly}
                onClick={() => void reuse(rule)}
              >
                <GitBranch size={17} />
                <span>
                  {rule.name}
                  <small>
                    v{rule.publishedVersion} · {rule.kind.toLowerCase()}
                  </small>
                </span>
                <span>+</span>
              </button>
            ))}
          <CatalogPagination
            label="Reusable rules"
            offset={catalog.offset}
            limit={catalog.limit}
            total={catalog.data.total}
            loading={catalog.loading}
            onPage={catalog.setOffset}
          />
        </>
      )}
      {(error || catalogError || catalog.error) && (
        <Alert
          severity="error"
          onClose={error ? () => setError("") : undefined}
        >
          {error || catalogError || catalog.error}
        </Alert>
      )}
    </aside>
  );
}
