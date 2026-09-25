import { useState } from "react";
import { Alert, Button, CircularProgress, Snackbar } from "@mui/material";
import WorkspaceHeader from "./app/WorkspaceHeader";
import Library from "./features/library/LibraryPage";
import Editor from "./features/editor/Editor";
import ApiPage from "./features/execution/ApiPage";
import SourcesPage from "./features/sources/SourcesPage";
import Sidebar from "./app/Sidebar";
import CreateRuleDialog from "./app/CreateRuleDialog";
import { parseRoute } from "./app/routing";
import { useWorkspaceNavigation } from "./app/useWorkspaceNavigation";
import { useRuleLibrary } from "./app/useRuleLibrary";
import { useAsyncResource } from "./hooks/useAsyncResource";
import { ruleApi } from "./api/rules";
import type { Rule } from "./types";
export default function App() {
  const library = useRuleLibrary();
  const { rules, loading } = library;
  const [savedRule, setSavedRule] = useState<Rule | null>(null);
  const upsert = (rule: Rule) => {
    setSavedRule(rule);
    library.upsert(rule);
  };
  const { route, navigate, setDirty } = useWorkspaceNavigation();
  const [notice, setNotice] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const newRule = () => setCreateOpen(true);
  const parsed = parseRoute(route),
    selectedId = parsed.ruleId,
    requestedVersion = parsed.version;
  const [detailAttempt, setDetailAttempt] = useState(0);
  const detail = useAsyncResource(
    `${selectedId}:${detailAttempt}`,
    (signal) => ruleApi.get(selectedId!, { signal }),
    null as Rule | null,
    0,
    !!selectedId,
  );
  const selected =
    savedRule?.id === selectedId &&
    (!detail.data || savedRule.revision >= detail.data.revision)
      ? savedRule
      : detail.data;
  return (
    <div className="app-shell">
      <Sidebar
        rules={rules}
        library={library}
        route={route}
        selectedId={selectedId}
        loading={loading}
        navigate={navigate}
        newRule={newRule}
      />
      <main className={`main-content ${selected ? "editor-main" : ""}`}>
        <WorkspaceHeader
          route={route}
          ruleName={selected?.name}
          navigate={navigate}
        />
        {selectedId && !selected && detail.loading ? (
          <div className="center-state">
            <CircularProgress size={28} />
            <p>Loading rule…</p>
          </div>
        ) : selectedId && detail.error ? (
          <div className="center-state">
            <Alert severity="error">Could not load rule: {detail.error}</Alert>
            <Button onClick={() => setDetailAttempt((value) => value + 1)}>
              Retry rule
            </Button>
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
            library={library}
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
