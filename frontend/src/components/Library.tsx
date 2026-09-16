import { useState } from "react";
import { Button, Chip, InputAdornment, TextField } from "@mui/material";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Braces,
  Check,
  Layers3,
  Plus,
  Search,
  Workflow,
} from "lucide-react";
import type { Kind, Rule } from "../types";
import { kindLabel } from "../types";
import { KindIcon, NodeIcon } from "./Icons";

function MiniGraph({ rule }: { rule: Rule }) {
  const { nodes, edges, inputs } = rule.draft;
  const condition = nodes.find((n) => n.type === "CONDITION");
  const input = nodes.find((n) => n.type === "INPUT");
  const formula =
    nodes.find((n) => n.type === "FORMULA") ||
    nodes.find((n) => n.type === "OUTPUT");
  const branches = ["true", "false"].map((branch) =>
    nodes.find(
      (n) =>
        n.id ===
        edges.find(
          (e) => e.source === condition?.id && e.sourceHandle === branch,
        )?.target,
    ),
  );
  return (
    <div
      className={`mini-graph mini-${rule.kind.toLowerCase()}`}
      aria-hidden="true"
    >
      {condition ? (
        <>
          {rule.kind === "DECISION_TREE" && (
            <>
              <div className="mini-box mini-input">
                <span />
                {input?.label || "Inputs"}
              </div>
              <div className="mini-stem" />
            </>
          )}
          <div className="mini-box mini-condition">
            <NodeIcon type="CONDITION" size={12} />
            {condition.label}
          </div>
          <div className="mini-branch">
            <span>True</span>
            <span>False</span>
          </div>
          <div className="mini-row">
            {branches.map((node, i) => (
              <div
                key={i}
                className={`mini-box ${node?.type === "REFERENCE" ? "mini-reuse" : node?.type === "CONDITION" ? "mini-condition" : "mini-output"}`}
              >
                {node && <NodeIcon type={node.type} size={12} />}
                <span>{node?.label || "Not connected"}</span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="formula-preview">
            <span>ƒ</span>
            <code title={formula?.expression || ""}>
              {formula?.expression || "Connect your logic"}
            </code>
          </div>
          <div className="formula-caption">
            {inputs.slice(0, 2).map((p) => (
              <span key={p.name}>{p.name}</span>
            ))}
            <ArrowRight size={13} />
            <strong>{formula?.output || "result"}</strong>
          </div>
        </>
      )}
    </div>
  );
}
export default function Library({
  rules,
  onOpen,
  onCreate,
  onDocs,
}: {
  rules: Rule[];
  onOpen: (r: Rule) => void;
  onCreate: () => void;
  onDocs: () => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Kind | "ALL">("ALL");
  const published = rules.filter((r) => r.publishedVersion).length;
  const references = rules.reduce(
    (sum, r) =>
      sum + r.draft.nodes.filter((n) => n.type === "REFERENCE").length,
    0,
  );
  const filtered = rules.filter(
    (r) =>
      (filter === "ALL" || r.kind === filter) &&
      `${r.name} ${r.id} ${r.description}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
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
            <span>Total rules</span>
            <strong>{rules.length.toString().padStart(2, "0")}</strong>
          </div>
          <small>Across your workspace</small>
        </div>
        <div className="stat">
          <span className="stat-icon green">
            <Check size={19} />
          </span>
          <div>
            <span>Published</span>
            <strong>{published.toString().padStart(2, "0")}</strong>
          </div>
          <small>
            <span className="status-dot published" />
            Ready to execute
          </small>
        </div>
        <div className="stat">
          <span className="stat-icon purple">
            <Braces size={19} />
          </span>
          <div>
            <span>Rule references</span>
            <strong>{references.toString().padStart(2, "0")}</strong>
          </div>
          <small>Connected, reusable logic</small>
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
                {type === "ALL" && <span>{rules.length}</span>}
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
      <div className="rule-grid">
        {[...filtered]
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          .map((rule) => (
            <button
              key={rule.id}
              className="rule-card"
              onClick={() => onOpen(rule)}
            >
              <div className="rule-card-top">
                <span className={`kind-icon ${rule.kind.toLowerCase()}`}>
                  <KindIcon kind={rule.kind} />
                </span>
                <Chip
                  size="small"
                  className={
                    rule.publishedVersion ? "published-chip" : "draft-chip"
                  }
                  label={
                    rule.publishedVersion
                      ? `Published · v${rule.publishedVersion}`
                      : "Draft"
                  }
                />
              </div>
              <div className="rule-card-title">
                <h3>{rule.name}</h3>
                <ArrowUpRight size={17} />
              </div>
              <p>
                {rule.description ||
                  "Add a description to explain what this rule does."}
              </p>
              <MiniGraph rule={rule} />
              <div className="rule-card-footer">
                <span>{kindLabel[rule.kind]}</span>
                <span>
                  {rule.draft.nodes.length} nodes
                  <span className="tiny-divider" />
                  {rule.draft.inputs.length} inputs
                </span>
              </div>
            </button>
          ))}
        {!filtered.length && (
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
