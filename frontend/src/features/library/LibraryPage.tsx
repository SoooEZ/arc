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
import type { Kind, RuleSummary } from "../../types";
import { kinds, ruleKinds } from "../../domain/ruleKinds";
import type { useRuleLibrary } from "../../app/useRuleLibrary";
import CatalogPagination from "../../components/CatalogPagination";
import RuleCard from "./RuleCard";

type KindFilter = Kind | "ALL";
/** One tab for every rule kind, in the order the create dialog offers them. */
const kindFilters: KindFilter[] = ["ALL", ...kinds];
const kindFilterLabel = (filter: KindFilter) =>
  filter === "ALL" ? "All rules" : ruleKinds[filter].pluralLabel;

function EmptyLibrary({
  filtered,
  onClearFilters,
  onCreate,
}: {
  filtered: boolean;
  onClearFilters: () => void;
  onCreate: () => void;
}) {
  const empty = filtered
    ? {
        title: "No rules match this view",
        hint: "Try another search or rule type.",
        action: "Clear filters",
        onAction: onClearFilters,
      }
    : {
        title: "Build your first rule",
        hint: "Start with a formula, condition, or decision tree.",
        action: "Create rule",
        onAction: onCreate,
      };
  return (
    <div className="empty-library">
      <Search size={28} />
      <h3>{empty.title}</h3>
      <p>{empty.hint}</p>
      <Button onClick={empty.onAction}>{empty.action}</Button>
    </div>
  );
}

export default function Library({
  library,
  onOpen,
  onCreate,
  onDocs,
}: {
  library: ReturnType<typeof useRuleLibrary>;
  onOpen: (r: RuleSummary) => void;
  onCreate: () => void;
  onDocs: () => void;
}) {
  const {
    rules,
    search: query,
    setSearch: setQuery,
    kind: filter,
    setKind: setFilter,
  } = library;
  const published = rules.filter((r) => r.publishedVersion).length;
  const references = rules.reduce((sum, r) => sum + r.referenceCount, 0);
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
        <div className="filter-tabs" role="group" aria-label="Rule kind">
          {kindFilters.map((type) => (
            <button
              key={type}
              className={filter === type ? "active" : ""}
              aria-pressed={filter === type}
              onClick={() => setFilter(type)}
            >
              {kindFilterLabel(type)}
            </button>
          ))}
        </div>
        <TextField
          placeholder="Search rules…"
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
            // On the input itself: a root aria-label lands on MUI's FormControl div.
            htmlInput: { "aria-label": "Search rules" },
          }}
          sx={{ width: 235 }}
        />
      </div>
      <div className="section-meta">
        <span>
          {rules.length} {rules.length === 1 ? "rule" : "rules"}
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
          action={<Button onClick={library.retry}>Retry</Button>}
        >
          {library.loadError}
        </Alert>
      )}
      <div className="rule-grid">
        {[...rules]
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          .map((rule) => (
            <RuleCard key={rule.id} rule={rule} onOpen={onOpen} />
          ))}
        {!library.loading && !library.loadError && !rules.length && (
          <EmptyLibrary
            filtered={query !== "" || filter !== "ALL"}
            onClearFilters={() => {
              setQuery("");
              setFilter("ALL");
            }}
            onCreate={onCreate}
          />
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
