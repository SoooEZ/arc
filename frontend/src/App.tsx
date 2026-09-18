import { useState } from "react";
import { Alert, Button, CircularProgress, Snackbar } from "@mui/material";
import { ChevronRight, Radio } from "lucide-react";
import Library from "./components/Library";
import Editor from "./components/Editor";
import ApiPage from "./components/ApiPage";
import SourcesPage from "./components/SourcesPage";
import Sidebar from "./app/Sidebar";
import CreateRuleDialog from "./app/CreateRuleDialog";
import { parseRoute } from "./app/routing";
import { useWorkspaceNavigation } from "./app/useWorkspaceNavigation";
import { useRuleLibrary } from "./app/useRuleLibrary";
export default function App() {
  const { rules, loading, loadError, load, upsert } = useRuleLibrary();
  const { route, navigate, setDirty } = useWorkspaceNavigation();
  const [notice, setNotice] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const newRule = () => setCreateOpen(true);
  const parsed = parseRoute(route),
    selectedId = parsed.ruleId,
    requestedVersion = parsed.version;
  const selected = rules.find((rule) => rule.id === selectedId);
  return (
    <div className="app-shell">
      <Sidebar
        rules={rules}
        route={route}
        selectedId={selectedId}
        loading={loading}
        navigate={navigate}
        newRule={newRule}
      />
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
            mode={parsed.mode}
            requestedVersion={requestedVersion}
            requestedNode={parsed.node}
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
      {createOpen && (
        <CreateRuleDialog
          onClose={() => setCreateOpen(false)}
          onCreated={(rule) => {
            upsert(rule);
            setCreateOpen(false);
            navigate(`/rules/${rule.id}`);
            setNotice("Rule created. Make it yours.");
          }}
        />
      )}
      <Snackbar
        open={!!notice}
        autoHideDuration={4000}
        onClose={() => setNotice("")}
        message={notice}
      />
    </div>
  );
}
