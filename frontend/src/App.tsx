import { lazy, useCallback, useState, type ReactNode } from "react";
import { Alert, Button, CircularProgress, Snackbar } from "@mui/material";
import WorkspaceHeader from "./app/WorkspaceHeader";
import Library from "./features/library/LibraryPage";
import ApiPage from "./features/execution/ApiPage";
import SourcesPage from "./features/sources/SourcesPage";
import Sidebar from "./app/Sidebar";
import CreateRuleDialog from "./app/CreateRuleDialog";
import { RecoverableBoundary } from "./app/RecoverableBoundary";
import { LazyBoundary } from "./components/LazyBoundary";
import { pagePath, parseRoute, rulePath, type RuleRoute } from "./app/routing";
import { useWorkspaceNavigation } from "./app/useWorkspaceNavigation";
import { useRuleLibrary } from "./app/useRuleLibrary";
import { useCodeStudioTarget } from "./app/useCodeStudioTarget";
import { useChunkLoadFailed } from "./app/chunkLoadFailures";
import { useAsyncResource } from "./hooks/useAsyncResource";
import { ruleApi } from "./api/rules";
import { sameRule } from "./domain/ruleIdentity";
import { formulaMetadata } from "./features/studio/formulaMetadata";
import { pinnedRuleVersions } from "./app/pinnedVersions";
import type { Rule, RuleSummary } from "./types";

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
  const { route, navigate, redirect, setDirty } = useWorkspaceNavigation();
  const view = parseRoute(route);
  const library = useRuleLibrary(view.page === "library");
  const [savedRule, setSavedRule] = useState<Rule | null>(null);
  // Each notice is its own Snackbar (keyed by its number), so it gets the
  // whole display time: a replaced message kept the old one's timer (a publish
  // notice shown for 0.2 s) and a repeated one did not show again.
  const [notice, setNotice] = useState<{ id: number; message: string } | null>(
    null,
  );
  const notify = useCallback(
    (message: string) =>
      setNotice((shown) => ({ id: (shown?.id ?? 0) + 1, message })),
    [],
  );
  const [createOpen, setCreateOpen] = useState(false);
  const chunkFailed = useChunkLoadFailed();
  const newRule = () => setCreateOpen(true);
  // Stable, so the library's memoized cards skip the renders its search causes.
  const openRule = useCallback(
    (rule: RuleSummary) => navigate(rulePath({ ruleId: rule.id })),
    [navigate],
  );
  const ruleId = view.page === "rule" ? view.ruleId : null;
  const requestedVersion = view.page === "rule" ? view.version : null;
  const [detailAttempt, setDetailAttempt] = useState(0);
  const detail = useAsyncResource<Rule | null>(
    `${ruleId}:${requestedVersion}:${detailAttempt}`,
    ruleId ? (signal) => ruleApi.get(ruleId, { signal }) : null,
    null,
  );
  // The saved copy stands in for the fresh read only for the same rule, not
  // for a rule created again under a deleted ID, whatever its revision.
  const selected =
    detail.data &&
    (savedRule &&
    sameRule(savedRule, detail.data) &&
    savedRule.revision >= detail.data.revision
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
    routeVersion: requestedVersion,
    openedRuleId: selected?.id ?? null,
    navigate,
    createRule: newRule,
    notify,
  });
  /**
   * Nothing keeps offering a deleted rule: saved copy, library page, Code studio
   * target or Formula metadata. A deletion outlives its editor, so this may run
   * after another rule was saved.
   */
  const forgetDeletedRule = (id: string) => {
    setSavedRule((saved) => (saved?.id === id ? null : saved));
    library.markChanged();
    codeStudio.forget(id);
    formulaMetadata.forget(id);
    pinnedRuleVersions.forget(id);
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
            mode={rule.mode}
            requestedVersion={rule.version}
            requestedNode={rule.node}
            onSaved={acknowledgeSave}
            onDirty={setDirty}
            onDeleted={forgetDeletedRule}
            navigate={navigate}
            redirect={redirect}
            notify={notify}
          />
        </LazyBoundary>
      );
    // A deleted or unknown rule cannot be retried into existence.
    if (detail.status === 404)
      return (
        <div className="center-state">
          <h2>Rule not found</h2>
          <Button onClick={() => navigate(pagePath("library"))}>
            Back to library
          </Button>
        </div>
      );
    if (detail.error)
      return (
        <div className="center-state">
          <Alert severity="error">Could not load rule: {detail.error}</Alert>
          <Button onClick={() => setDetailAttempt((value) => value + 1)}>
            Retry rule
          </Button>
        </div>
      );
    return <LoadingRule />;
  };

  const workspaceContent = (): ReactNode => {
    switch (view.page) {
      case "rule":
        return ruleContent(view);
      case "sources":
        return <SourcesPage notify={notify} />;
      case "playground":
      case "docs":
        return <ApiPage mode={view.page} notify={notify} />;
      case "library":
        return (
          <Library
            library={library}
            onOpen={openRule}
            onCreate={newRule}
            onDocs={() => navigate(pagePath("docs"))}
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
            navigate(rulePath({ ruleId: rule.id }));
            notify("Rule created. Make it yours.");
          }}
        />
      )}
      <Snackbar
        key={notice?.id}
        open={notice !== null}
        autoHideDuration={4000}
        // Only the timeout or Escape closes a notice: MUI also reports any click elsewhere
        // as "clickaway", which made error notices vanish at once.
        onClose={(_event, reason) => {
          if (reason !== "clickaway") setNotice(null);
        }}
        message={notice?.message}
      />
    </div>
  );
}
