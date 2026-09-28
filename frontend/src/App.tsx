import { lazy, useState, type ReactNode } from "react";
import { Alert, Button, CircularProgress, Snackbar } from "@mui/material";
import WorkspaceHeader from "./app/WorkspaceHeader";
import Library from "./features/library/LibraryPage";
import ApiPage from "./features/execution/ApiPage";
import SourcesPage from "./features/sources/SourcesPage";
import Sidebar from "./app/Sidebar";
import CreateRuleDialog from "./app/CreateRuleDialog";
import { RecoverableBoundary } from "./app/RecoverableBoundary";
import { LazyBoundary } from "./components/LazyBoundary";
import { parseRoute, type RuleRoute } from "./app/routing";
import { useWorkspaceNavigation } from "./app/useWorkspaceNavigation";
import { useRuleLibrary } from "./app/useRuleLibrary";
import { useCodeStudioTarget } from "./app/useCodeStudioTarget";
import { useChunkLoadFailed } from "./app/chunkLoadFailures";
import { useAsyncResource } from "./hooks/useAsyncResource";
import { ruleApi } from "./api/rules";
import type { Rule } from "./types";

// The rule editor and React Flow download only when a rule opens.
const Editor = lazy(() => import("./app/EditorRoute"));

function LoadingRule() {
  return (
    <div className="center-state">
      <CircularProgress size={28} />
      <p>Loading rule…</p>
    </div>
  );
}

function ReloadNotice() {
  return (
    <Alert
      severity="warning"
      className="workspace-notice"
      action={
        <Button
          color="inherit"
          size="small"
          onClick={() => window.location.reload()}
        >
          Reload
        </Button>
      }
    >
      Part of ARC could not be downloaded, possibly because a new version was
      deployed. Save your changes, then reload the page.
    </Alert>
  );
}

function unknownPage(route: never): never {
  throw new Error(`Unknown workspace page: ${JSON.stringify(route)}`);
}

export default function App() {
  const { route, navigate, setDirty } = useWorkspaceNavigation();
  const view = parseRoute(route);
  const library = useRuleLibrary(view.page === "library");
  const [savedRule, setSavedRule] = useState<Rule | null>(null);
  const [notice, setNotice] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const chunkFailed = useChunkLoadFailed();
  const newRule = () => setCreateOpen(true);
  const ruleId = view.page === "rule" ? view.ruleId : null;
  const requestedVersion = view.page === "rule" ? view.version : null;
  const [detailAttempt, setDetailAttempt] = useState(0);
  const detail = useAsyncResource<Rule | null>(
    `${ruleId}:${requestedVersion}:${detailAttempt}`,
    (signal) => ruleApi.get(ruleId!, { signal }),
    null,
    0,
    !!ruleId,
  );
  const selected =
    detail.data &&
    (savedRule?.id === ruleId && savedRule.revision >= detail.data.revision
      ? savedRule
      : detail.data);
  /** A save or create acknowledgement; the hidden library reloads when shown. */
  const acknowledgeSave = (rule: Rule) => {
    setSavedRule(rule);
    library.markChanged();
  };
  const codeStudio = useCodeStudioTarget({
    route,
    routeRuleId: ruleId,
    openedRuleId: selected?.id ?? null,
    navigate,
    createRule: newRule,
    notify: setNotice,
  });
  /** Nothing keeps offering a deleted rule: saved copy, library page or Code studio target. */
  const forgetDeletedRule = (id: string) => {
    if (savedRule?.id === id) setSavedRule(null);
    library.markChanged();
    codeStudio.forget(id);
  };

  const ruleContent = (rule: RuleRoute): ReactNode => {
    if (selected)
      return (
        // One editor session per rule and requested version.
        <LazyBoundary
          key={`${selected.id}:${rule.version}`}
          label="rule editor"
          fallback={<LoadingRule />}
        >
          <Editor
            rule={selected}
            rules={library.rules}
            mode={rule.mode}
            requestedVersion={rule.version}
            requestedNode={rule.node}
            onSaved={acknowledgeSave}
            onDirty={setDirty}
            onDeleted={forgetDeletedRule}
            navigate={navigate}
            notify={setNotice}
          />
        </LazyBoundary>
      );
    if (detail.loading) return <LoadingRule />;
    if (detail.error)
      return (
        <div className="center-state">
          <Alert severity="error">Could not load rule: {detail.error}</Alert>
          <Button onClick={() => setDetailAttempt((value) => value + 1)}>
            Retry rule
          </Button>
        </div>
      );
    return (
      <div className="center-state">
        <h2>Rule not found</h2>
        <Button onClick={() => navigate("/library")}>Back to library</Button>
      </div>
    );
  };

  const workspaceContent = (): ReactNode => {
    switch (view.page) {
      case "rule":
        return ruleContent(view);
      case "sources":
        return <SourcesPage notify={setNotice} />;
      case "playground":
      case "docs":
        return (
          <ApiPage mode={view.page} rules={library.rules} notify={setNotice} />
        );
      case "library":
        return (
          <Library
            library={library}
            onOpen={(rule) => navigate(`/rules/${rule.id}`)}
            onCreate={newRule}
            onDocs={() => navigate("/docs")}
          />
        );
      default:
        return unknownPage(view);
    }
  };

  return (
    <div className="app-shell">
      <Sidebar
        route={view}
        navigate={navigate}
        openCodeStudio={() => void codeStudio.open()}
      />
      <main className={`main-content ${selected ? "editor-main" : ""}`}>
        <WorkspaceHeader
          route={view}
          ruleName={selected?.name}
          navigate={navigate}
        />
        {chunkFailed && <ReloadNotice />}
        <RecoverableBoundary title="This page stopped working" resetKey={route}>
          {workspaceContent()}
        </RecoverableBoundary>
      </main>
      {createOpen && (
        <CreateRuleDialog
          onClose={() => setCreateOpen(false)}
          onCreated={(rule) => {
            acknowledgeSave(rule);
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
