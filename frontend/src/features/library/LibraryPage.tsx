import {
  Alert,
  CircularProgress,
  Button,
  InputAdornment,
  TextField,
} from "@mui/material";
import {
  ArrowDown,
  ArrowRight,
  Braces,
  Check,
  Layers3,
  Plus,
  Search,
  Workflow,
} from "lucide-react";
import type { RuleSummary } from "../../types";
import type { useRuleLibrary } from "../../app/useRuleLibrary";
import CatalogPagination from "../../components/CatalogPagination";
import RuleCard from "./RuleCard";

export default function Library({
  rules,
  library,
  onOpen,
  onCreate,
  onDocs,
}: {
  rules: RuleSummary[];
  library: ReturnType<typeof useRuleLibrary>;
  onOpen: (r: RuleSummary) => void;
  onCreate: () => void;
  onDocs: () => void;
}) {
  const {
    search: query,
    setSearch: setQuery,
    kind: filter,
    setKind: setFilter,
  } = library;
  const published = rules.filter((r) => r.publishedVersion).length;
  const references = rules.reduce((sum, r) => sum + r.referenceCount, 0);
  const filtered = rules;
  return (
    <div className="library-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            <span />
            YOUR LOGIC, CONNECTED
          </div>
          <h1>Rule library</h1>
          <p>A home for the decisions that power your business.</p>
        </div>
        <Button
          variant="contained"
          startIcon={<Plus size={17} />}
          onClick={onCreate}
        >
          Create rule
        </Button>
      </div>
      <div className="stats-row">
        <div className="stat">
          <span className="stat-icon">
            <Layers3 size={19} />
          </span>
          <div>
            <span>Matching rules</span>
            <strong>{library.total.toString().padStart(2, "0")}</strong>
          </div>
          <small>Matching current filters</small>
        </div>
        <div className="stat">
          <span className="stat-icon green">
            <Check size={19} />
          </span>
          <div>
            <span>Published on page</span>
            <strong>{published.toString().padStart(2, "0")}</strong>
          </div>
          <small>
            <span className="status-dot published" />
            On this page
          </small>
        </div>
        <div className="stat">
          <span className="stat-icon purple">
            <Braces size={19} />
          </span>
          <div>
            <span>References on page</span>
            <strong>{references.toString().padStart(2, "0")}</strong>
          </div>
          <small>On this page</small>
        </div>
      </div>
      <div className="library-toolbar">
        <div className="filter-tabs">
          {(["ALL", "DECISION_TREE", "FORMULA", "RULE"] as const).map(
            (type) => (
              <button
                key={type}
                className={filter === type ? "active" : ""}
                onClick={() => setFilter(type)}
              >
                {type === "ALL"
                  ? "All rules"
                  : type === "DECISION_TREE"
                    ? "Decision trees"
                    : type === "FORMULA"
                      ? "Formulas"
                      : "Conditions"}
              </button>
            ),
          )}
        </div>
        <TextField
          placeholder="Search rules…"
          aria-label="Search rules"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <Search size={16} />
                </InputAdornment>
              ),
            },
          }}
          sx={{ width: 235 }}
        />
      </div>
      <div className="section-meta">
        <span>
          {filtered.length} {filtered.length === 1 ? "rule" : "rules"}
        </span>
        <span>
          Last updated <ArrowDown size={12} />
        </span>
      </div>
      {library.loading && (
        <CircularProgress size={20} aria-label="Loading rules" />
      )}
      {library.loadError && (
        <Alert
          severity="error"
          action={<Button onClick={library.load}>Retry</Button>}
        >
          {library.loadError}
        </Alert>
      )}
      <div className="rule-grid">
        {[...filtered]
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          .map((rule) => (
            <RuleCard key={rule.id} rule={rule} onOpen={onOpen} />
          ))}
        {!library.loading && !library.loadError && !filtered.length && (
          <div className="empty-library">
            <Search size={28} />
            <h3>
              {query || filter !== "ALL"
                ? "No rules match this view"
                : "Build your first rule"}
            </h3>
            <p>
              {query || filter !== "ALL"
                ? "Try another search or rule type."
                : "Start with a formula, condition, or decision tree."}
            </p>
            <Button
              onClick={
                query || filter !== "ALL"
                  ? () => {
                      setQuery("");
                      setFilter("ALL");
                    }
                  : onCreate
              }
            >
              {query || filter !== "ALL" ? "Clear filters" : "Create rule"}
            </Button>
          </div>
        )}
      </div>
      <CatalogPagination
        label="Library rules"
        offset={library.page.offset}
        limit={library.page.limit}
        total={library.total}
        loading={library.loading}
        onPage={library.page.setOffset}
      />
      <div className="getting-started">
        <div className="getting-visual">
          <Workflow size={28} />
          <span className="connection-line" />
          <div>
            <code>{"{ }"}</code>
          </div>
        </div>
        <div>
          <span className="eyebrow">FROM LOGIC TO ACTION</span>
          <h3>Your rules. Any application.</h3>
          <p>
            Publish a rule, send your inputs, and get a result with a full
            decision trace.
          </p>
        </div>
        <Button endIcon={<ArrowRight size={16} />} onClick={onDocs}>
          Meet the API
        </Button>
      </div>
      <div className="library-footer">
        <span>ARC / Aggregation, Rule & Calculation</span>
        <span>Thoughtful logic. Predictable outcomes.</span>
      </div>
    </div>
  );
}
