import { useState } from "react";
import {
  Alert,
  CircularProgress,
  Button,
  InputAdornment,
  TextField,
} from "@mui/material";
import { ArrowDown, ArrowRight, Plus, Search, Workflow } from "lucide-react";
import type { Kind, Rule, RuleSummary } from "../../types";
import { kinds, ruleKinds } from "../../domain/ruleKinds";
import type { useRuleLibrary } from "../../app/useRuleLibrary";
import { RecoverableBoundary } from "../../app/RecoverableBoundary";
import CatalogPagination from "../../components/CatalogPagination";
import RuleCard from "./RuleCard";
import DuplicateRuleDialog from "./DuplicateRuleDialog";
import { newestFirst } from "./libraryOrder";

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
  onOpenCode,
  onCreate,
  onDuplicated,
  onDocs,
}: {
  library: ReturnType<typeof useRuleLibrary>;
  onOpen: (r: RuleSummary) => void;
  /** Opens a rule in Code studio; stable, like `onOpen`, for the memoized cards. */
  onOpenCode: (r: RuleSummary) => void;
  onCreate: () => void;
  /** A rule copied from a card, with the notice that says what it came from. */
  onDuplicated: (rule: Rule, notice: string) => void;
  onDocs: () => void;
}) {
  const [duplicating, setDuplicating] = useState<RuleSummary | null>(null);
  const {
    rules,
    search: query,
    setSearch: setQuery,
    kind: filter,
    setKind: setFilter,
  } = library;
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
        {newestFirst(rules).map((rule) => (
          // A card indexes its rule's kind and node kinds, which a bundle older
          // than the server may not know: such a card fails alone, not the page.
          <RecoverableBoundary
            key={rule.id}
            title="This rule card stopped working"
            resetKey={`${rule.id}:${rule.revision}`}
          >
            <RuleCard
              rule={rule}
              onOpen={onOpen}
              onDuplicate={setDuplicating}
              onOpenCode={onOpenCode}
            />
          </RecoverableBoundary>
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
      {duplicating && (
        <DuplicateRuleDialog
          source={duplicating}
          onClose={() => setDuplicating(null)}
          onDuplicated={(rule, notice) => {
            setDuplicating(null);
            onDuplicated(rule, notice);
          }}
        />
      )}
    </div>
  );
}
