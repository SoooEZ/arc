import { useEffect, useRef, useState, type MouseEvent } from "react";
import { Alert, TextField } from "@mui/material";
import { Braces, GitBranch, Puzzle } from "lucide-react";
import { usePagedSearch } from "../../hooks/usePagedSearch";
import CatalogPagination from "../../components/CatalogPagination";
import FunctionLibrary from "./FunctionLibrary";
import { ruleApi } from "../../api/rules";
import type { Definition, FunctionEntry, RuleSummary } from "../../types";
import { modules, referenceSnippet, reuseNodeId } from "./snippets";
import { insertsOnClick, useLibraryInsertion } from "./useLibraryInsertion";
import { formulaSuggestionProblem } from "./useFormulaSupport";
import { uniqueName } from "../../domain/ids";
import { variableNames } from "../../domain/variables";
import { scriptVariableNames } from "../../domain/expressionSymbols";
import { readRuleVersion } from "../../app/pinnedVersions";
import { paginationProps } from "../../hooks/usePagedResource";

type Pane = "functions" | "modules" | "reuse";
const panes: Pane[] = ["functions", "modules", "reuse"];

export default function StudioLibrary({
  ruleId,
  definition,
  source,
  functions,
  catalogError,
  formulaError,
  readOnly,
  onInsert,
  onBeginInsert,
  onInsertFormula,
}: {
  ruleId: string;
  definition: Definition;
  /** The code buffer, which may declare names the built definition does not have yet. */
  source: string;
  functions: FunctionEntry[];
  catalogError: string;
  /** Why `@` completion could not search published Formulas, or "". */
  formulaError: string;
  readOnly: boolean;
  onInsert: (snippet: string, atEnd?: boolean) => void;
  /**
   * Starts an insertion that first reads: the returned function inserts, or
   * throws when the code changed since the click.
   */
  onBeginInsert: () => (snippet: string, atEnd?: boolean) => void;
  onInsertFormula: (rule: RuleSummary, signal?: AbortSignal) => Promise<void>;
}) {
  const [search, setSearch] = useState("");
  const [pane, setPane] = useState<Pane>("functions");
  // The shown cards stay until the settled search answers, as in the library.
  const catalog = usePagedSearch(
    search,
    (query, offset, limit, signal) =>
      ruleApi.catalog(
        { offset, limit, search: query, publishedOnly: true },
        { signal },
      ),
    { enabled: pane === "reuse", keepPrevious: true },
  );
  const insertion = useLibraryInsertion();
  const { cancel } = insertion;
  const latest = useRef({ definition, source, readOnly });
  latest.current = { definition, source, readOnly };
  useEffect(() => {
    if (readOnly) cancel();
  }, [readOnly, cancel]);

  const reuse = (event: MouseEvent<HTMLButtonElement>, rule: RuleSummary) => {
    const pinned = rule.publishedVersion;
    if (readOnly || pinned === null) return;
    const nodeId = reuseNodeId(rule.id);
    const insert = onBeginInsert();
    insertion.onCardClick(event, rule.id, async (signal) => {
      // The page-wide cache of pinned versions, kept per incarnation of the
      // rule, which Reference cards and Formula metadata read too.
      const version = await readRuleVersion(rule, pinned, signal);
      if (signal.aborted || latest.current.readOnly) return;
      const { definition: built, source: buffer } = latest.current;
      // A name in use, also one only the unbuilt buffer declares, would be overwritten.
      const resultName = uniqueName("result_", [
        ...variableNames(built),
        ...scriptVariableNames(buffer),
      ]);
      insert(referenceSnippet(rule, version, built, nodeId, resultName), true);
    });
  };
  const formulaProblem = formulaError
    ? formulaSuggestionProblem(formulaError)
    : "";

  return (
    <aside className="studio-library">
      <div className="studio-library-title">
        <Puzzle size={17} />
        <strong>Build with blocks</strong>
      </div>
      <div className="studio-tabs" role="group" aria-label="Library panes">
        {panes.map((item) => (
          <button
            key={item}
            className={pane === item ? "active" : ""}
            aria-pressed={pane === item}
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
              onClick={(event) => {
                if (insertsOnClick(event))
                  onInsert(module.snippet, module.placement === "end");
              }}
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
                onClick={(event) => reuse(event, rule)}
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
            {...paginationProps(catalog)}
          />
        </>
      )}
      {(insertion.error || catalogError || catalog.error || formulaProblem) && (
        <Alert
          severity="error"
          onClose={insertion.error ? insertion.dismissError : undefined}
        >
          {insertion.error || catalogError || catalog.error || formulaProblem}
        </Alert>
      )}
    </aside>
  );
}
