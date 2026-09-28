import { useEffect, useRef, useState } from "react";
import { Alert, TextField } from "@mui/material";
import { Braces, GitBranch, Puzzle } from "lucide-react";
import { usePagedResource } from "../../hooks/usePagedResource";
import CatalogPagination from "../../components/CatalogPagination";
import FunctionLibrary from "./FunctionLibrary";
import { ruleApi } from "../../api/rules";
import type { Definition, FunctionEntry, RuleSummary } from "../../types";
import { modules, referenceSnippet, reuseNodeId } from "./snippets";
import { useLibraryInsertion } from "./useLibraryInsertion";

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
  const insertion = useLibraryInsertion();
  const { cancel } = insertion;
  const latest = useRef({ definition, readOnly, onInsert });
  latest.current = { definition, readOnly, onInsert };
  useEffect(() => {
    if (readOnly) cancel();
  }, [readOnly, cancel]);

  const reuse = (rule: RuleSummary) => {
    const pinned = rule.publishedVersion;
    if (readOnly || pinned === null) return;
    const nodeId = reuseNodeId(rule.id);
    void insertion.run(rule.id, async (signal) => {
      const version = await ruleApi.version(rule.id, pinned, { signal });
      if (signal.aborted || latest.current.readOnly) return;
      latest.current.onInsert(
        referenceSnippet(rule, version, latest.current.definition, nodeId),
        true,
      );
    });
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
                disabled={readOnly || insertion.busy === rule.id}
                onClick={() => reuse(rule)}
              >
                <GitBranch size={17} />
                <span>
                  {rule.name}
                  <small>
                    v{rule.publishedVersion} · {rule.kind.toLowerCase()}
                    {insertion.busy === rule.id ? " · loading…" : ""}
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
      {(insertion.error || catalogError || catalog.error) && (
        <Alert
          severity="error"
          onClose={insertion.error ? insertion.dismissError : undefined}
        >
          {insertion.error || catalogError || catalog.error}
        </Alert>
      )}
    </aside>
  );
}
