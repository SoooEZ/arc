import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Snackbar,
  TextField,
} from "@mui/material";
import {
  ArrowUpRight,
  BookOpen,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Layers3,
  Plus,
  Radio,
  Terminal,
  Workflow,
} from "lucide-react";
import { api, errorMessage } from "./api";
import type { Kind, Rule } from "./types";
import { kindLabel } from "./types";
import { ArcMark, KindIcon } from "./components/Icons";
import Library from "./components/Library";
import Editor from "./components/Editor";
import ApiPage from "./components/ApiPage";
import SourcesPage from "./components/SourcesPage";

const initialRoute = () => window.location.hash.slice(1) || "/library";
export default function App() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [route, setRoute] = useState(initialRoute);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [id, setId] = useState("");
  const [kind, setKind] = useState<Kind>("DECISION_TREE");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const load = useCallback(async () => {
    try {
      setLoadError("");
      setRules(await api.list());
    } catch (e) {
      setLoadError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const changed = () => {
      const next = initialRoute();
      if (next === route) return;
      const sameRule =
        /^(\/rules\/|\/studio\/)/.test(route) &&
        /^(\/rules\/|\/studio\/)/.test(next) &&
        route.replace(/^\/(rules|studio)\//, "") ===
          next.replace(/^\/(rules|studio)\//, "");
      if (
        dirty &&
        !sameRule &&
        !window.confirm(
          "You have unsaved changes. Leave this rule and discard them?",
        )
      ) {
        window.history.replaceState(null, "", `#${route}`);
        return;
      }
      if (!sameRule) setDirty(false);
      setRoute(next);
    };
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  }, [dirty, route]);
  useEffect(() => {
    const leave = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, [dirty]);
  const navigate = (path: string) => {
    window.location.hash = path;
  };
  const upsert = (rule: Rule) =>
    setRules((old) => [rule, ...old.filter((r) => r.id !== rule.id)]);
  const newRule = () => {
    setCreateOpen(true);
    setName("");
    setId("");
    setDescription("");
    setCreateError("");
  };
  const create = async () => {
    setCreating(true);
    setCreateError("");
    try {
      const rule = await api.create(id, name, description, kind);
      upsert(rule);
      setCreateOpen(false);
      navigate(`/rules/${rule.id}`);
      setNotice("Rule created. Make it yours.");
    } catch (e) {
      setCreateError(errorMessage(e));
    } finally {
      setCreating(false);
    }
  };
  const selectedId =
    route.startsWith("/rules/") || route.startsWith("/studio/")
      ? route.split("/")[2]?.split("?")[0]
      : null;
  const selected = rules.find((r) => r.id === selectedId);
  const requestedVersion =
    Number(new URLSearchParams(route.split("?")[1]).get("version")) || null;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => navigate("/library")}>
          <ArcMark />
          <span>
            arc<span className="brand-dot">.</span>
          </span>
          <span className="brand-beta">BETA</span>
        </button>
        <div className="workspace-switch">
          <span className="workspace-avatar">A</span>
          <div>
            <strong>ARC workspace</strong>
            <small>Rules & calculations</small>
          </div>
          <ChevronDown size={14} />
        </div>
        <div className="nav-section-label">WORKSPACE</div>
        <nav className="main-nav">
          <button
            className={
              route === "/library" || route.startsWith("/rules/")
                ? "active"
                : ""
            }
            onClick={() => navigate("/library")}
          >
            <Layers3 size={18} />
            Rule library<span className="nav-count">{rules.length}</span>
          </button>
          <button
            className={route === "/playground" ? "active" : ""}
            onClick={() => navigate("/playground")}
          >
            <Terminal size={18} />
            API playground
          </button>
          <button
            className={route === "/docs" ? "active" : ""}
            onClick={() => navigate("/docs")}
          >
            <BookOpen size={18} />
            API reference
            <ArrowUpRight size={14} className="nav-tail" />
          </button>
          <button
            className={route.startsWith("/studio/") ? "active" : ""}
            onClick={() =>
              rules.length
                ? navigate(`/studio/${selectedId || rules[0].id}`)
                : newRule()
            }
          >
            <Terminal size={18} />
            Code studio
          </button>
          <button
            className={route === "/sources" ? "active" : ""}
            onClick={() => navigate("/sources")}
          >
            <Workflow size={18} />
            Data sources
          </button>
        </nav>
        <div className="nav-section-label rules-label">
          YOUR RULES
          <button onClick={newRule} aria-label="Create rule">
            <Plus size={16} />
          </button>
        </div>
        <div className="sidebar-rules">
          {rules.map((rule) => (
            <button
              key={rule.id}
              title={rule.name}
              className={selectedId === rule.id ? "selected" : ""}
              onClick={() => navigate(`/rules/${rule.id}`)}
            >
              <KindIcon kind={rule.kind} size={16} />
              <span>{rule.name}</span>
              <span
                className={`status-dot ${rule.publishedVersion ? "published" : ""}`}
              />
            </button>
          ))}
          {!loading && !rules.length && (
            <div className="sidebar-empty">Your first rule starts here.</div>
          )}
        </div>
        <div className="sidebar-bottom">
          <div className="build-note">
            <Workflow size={19} />
            <strong>Build once. Reuse everywhere.</strong>
            <p>
              Connect your business logic,
              <br />
              one rule at a time.
            </p>
            <button onClick={() => navigate("/docs")}>
              Explore the API <ArrowUpRight size={14} />
            </button>
          </div>
          <button className="help-link" onClick={() => navigate("/docs")}>
            <CircleHelp size={17} />
            Getting started
            <ChevronRight size={14} />
          </button>
          <div className="environment">
            <span className="status-dot published" />
            <span>Development</span>
            <span>v0.2</span>
          </div>
        </div>
      </aside>
      <main className={`main-content ${selected ? "editor-main" : ""}`}>
        <header className="topbar">
          <div className="breadcrumbs">
            <span>Workspace</span>
            <ChevronRight size={13} />
            <button onClick={() => navigate("/library")}>
              {route === "/playground"
                ? "API playground"
                : route === "/docs"
                  ? "API reference"
                  : route === "/sources"
                    ? "Data sources"
                    : route.startsWith("/studio/")
                      ? "Code studio"
                      : "Rule library"}
            </button>
            {selected && (
              <>
                <ChevronRight size={13} />
                <strong>{selected.name}</strong>
              </>
            )}
          </div>
          <div className="topbar-right">
            <span className="open-access">
              <Radio size={13} />
              Open API
            </span>
            <span className="topbar-divider" />
            <span className="user-avatar">A</span>
          </div>
        </header>
        {loading ? (
          <div className="center-state">
            <CircularProgress size={28} />
            <p>Loading your workspace…</p>
          </div>
        ) : loadError ? (
          <div className="center-state">
            <Alert severity="error">Could not reach ARC: {loadError}</Alert>
            <Button onClick={load}>Retry connection</Button>
          </div>
        ) : selected ? (
          <Editor
            key={`${selected.id}:${requestedVersion}`}
            rule={selected}
            rules={rules}
            mode={route.startsWith("/studio/") ? "code" : "graph"}
            requestedVersion={requestedVersion}
            requestedNode={new URLSearchParams(route.split("?")[1]).get("node")}
            onSaved={upsert}
            onDirty={setDirty}
            navigate={navigate}
            notify={setNotice}
          />
        ) : selectedId ? (
          <div className="center-state">
            <h2>Rule not found</h2>
            <Button onClick={() => navigate("/library")}>
              Back to library
            </Button>
          </div>
        ) : route === "/sources" ? (
          <SourcesPage onDirty={setDirty} notify={setNotice} />
        ) : route === "/playground" || route === "/docs" ? (
          <ApiPage
            mode={route === "/docs" ? "docs" : "playground"}
            rules={rules}
            notify={setNotice}
          />
        ) : (
          <Library
            rules={rules}
            onOpen={(r) => navigate(`/rules/${r.id}`)}
            onCreate={newRule}
            onDocs={() => navigate("/docs")}
          />
        )}
      </main>
      <Dialog
        open={createOpen}
        onClose={() => !creating && setCreateOpen(false)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Create a rule</DialogTitle>
        <DialogContent>
          <p className="dialog-intro">
            Start with a working template, then shape it around your logic.
          </p>
          <div className="form-stack">
            <TextField
              autoFocus
              label="Rule name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setId(
                  e.target.value
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, "-")
                    .replace(/^-|-$/g, "")
                    .slice(0, 80),
                );
              }}
            />
            <TextField
              label="Rule ID"
              value={id}
              onChange={(e) => setId(e.target.value)}
              helperText="A permanent, unique ID used in API calls."
            />
            <TextField
              select
              label="Rule type"
              value={kind}
              onChange={(e) => setKind(e.target.value as Kind)}
            >
              {Object.entries(kindLabel).map(([value, label]) => (
                <MenuItem key={value} value={value}>
                  {label}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label="Description"
              multiline
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            {createError && <Alert severity="error">{createError}</Alert>}
            <Chip
              className="template-note"
              label="Includes a connected graph and sample inputs"
            />
          </div>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)} disabled={creating}>
            Cancel
          </Button>
          <Button
            variant="contained"
            startIcon={<Plus size={16} />}
            onClick={create}
            disabled={creating || !name.trim() || !id}
          >
            {creating ? "Creating…" : "Create rule"}
          </Button>
        </DialogActions>
      </Dialog>
      <Snackbar
        open={!!notice}
        autoHideDuration={4000}
        onClose={() => setNotice("")}
        message={notice}
      />
    </div>
  );
}
