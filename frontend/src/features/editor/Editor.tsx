import { lazy, useCallback, useMemo, useRef, useState } from "react";
import { Alert, Button, CircularProgress } from "@mui/material";
import { ReactFlowProvider } from "@xyflow/react";
import type { GraphProblem } from "../../api/errors";
import { LazyBoundary } from "../../components/LazyBoundary";
import { isCurrentGraphLocation, semanticGraphKey } from "../../domain/graph";
import Inspector from "./inspector/Inspector";
import TestPanel from "../execution/TestPanel";
import RuleSettings from "./RuleSettings";
import ReferenceDialog from "./ReferenceDialog";
import { useRuleDocument } from "./useRuleDocument";
import { useGraphCanvas } from "./canvas/useGraphCanvas";
import { useGraphProblems } from "./useGraphProblems";
import EditorHeader from "./EditorHeader";
import GraphCanvas from "./canvas/GraphCanvas";
import VersionHistory from "./VersionHistory";
import { useGraphCommands } from "./canvas/useGraphCommands";
import { useGraphFocus } from "./canvas/useGraphFocus";
import { exportDefinition } from "./exportDefinition";
import { usePreviewExecution } from "./usePreviewExecution";
import { useNodeDialog } from "./useNodeDialog";
import LazyNodeDialog from "./LazyNodeDialog";
import { defaultSelection, selectedNode } from "./nodeSelection";
import type { EditorProps, ReferenceTarget } from "./types";
const CodeStudio = lazy(() => import("../studio/CodeStudio"));
const NodeExpressionDialog = lazy(() => import("./NodeExpressionDialog"));
const NodeEditDialog = lazy(() => import("./NodeEditDialog"));
const noProblems: GraphProblem[] = [];
const noErrors: string[] = [];

/** Located failures of the current preview result and of the last command. */
function runtimeProblems(...problems: (GraphProblem | null)[]) {
  return problems.filter((problem): problem is GraphProblem => !!problem);
}

export default function Editor(props: EditorProps) {
  return (
    <ReactFlowProvider>
      <EditorContent {...props} />
    </ReactFlowProvider>
  );
}
function EditorContent({
  mode,
  rule: initial,
  rules,
  requestedVersion,
  requestedNode,
  onSaved,
  onDirty,
  onDeleted,
  navigate,
  notify,
  embedded = false,
  onOpenReference,
  initialProblems = noProblems,
}: EditorProps) {
  const [commandProblem, setCommandProblem] = useState<GraphProblem | null>(
    null,
  );
  const clearCommandProblem = useCallback(() => setCommandProblem(null), []);
  const document = useRuleDocument({
    initial,
    mode,
    requestedVersion,
    onSaved,
    onDirty,
    onDeleted,
    navigate,
    notify,
    reportCommandProblem: setCommandProblem,
  });
  const {
    rule,
    source,
    sourceDirty,
    diagnostics,
    readOnly,
    dirty,
    busy,
    capabilities: can,
    view,
    hasInvalidDefaults,
    onInvalidDefault,
    blockedByInvalidDefault,
    error,
    setError,
    versionLoading,
    versionError,
    versionUnavailable,
    retryVersion,
    edit,
    editMetadata,
    editSource,
    build,
    switchView,
    action,
    toggleTest,
    deleteRule,
  } = document;
  const graphKey = useMemo(() => semanticGraphKey(rule.draft), [rule.draft]);
  const preview = usePreviewExecution(rule.draft, graphKey);
  const [requestedSelection, setRequestedSelection] = useState(
    () => defaultSelection(initial.draft).id,
  );
  const node = selectedNode(rule.draft, requestedSelection);
  const selected = node.id;
  /** Selects a node unless an invalid default must be fixed before `action`. */
  const selectNode = useCallback(
    (id: string, action = "selecting another node") => {
      if (id !== selected && blockedByInvalidDefault(action)) return false;
      setRequestedSelection(id);
      return true;
    },
    [selected, blockedByInvalidDefault],
  );
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const nodeNameInput = useRef<HTMLInputElement>(null);
  const nodeDialog = useNodeDialog(rule.draft.nodes);
  const { openCode, openEdit, active: activeDialog } = nodeDialog;
  const openNodeCode = useCallback(
    (id: string) => {
      if (!blockedByInvalidDefault("opening node code")) openCode(id);
    },
    [blockedByInvalidDefault, openCode],
  );
  const [referenceTarget, setReferenceTarget] =
    useState<ReferenceTarget | null>(null);
  const [history, setHistory] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const codeRequest =
    activeDialog?.request.kind === "code" ? activeDialog.request : null;
  const { allProblems, nodeErrors } = useGraphProblems({
    rule,
    graphKey,
    version: requestedVersion,
    loading: versionUnavailable,
    invalidDefaults: hasInvalidDefaults,
    runtime: runtimeProblems(preview.problem, commandProblem),
    inherited: initialProblems,
    nodeCode: codeRequest,
    clearCommandProblem,
    onError: setError,
  });
  const canvas = useGraphCanvas({
    definition: rule.draft,
    selected,
    selectedEdge,
    setSelectedEdge,
    onExpression: openNodeCode,
    trace: preview.result,
    nodeErrors,
    edit,
  });
  const { measurements, requestFit } = canvas;
  const { patchNode, addNode, removeNode, arrange } = useGraphCommands({
    definition: rule.draft,
    measurements,
    edit,
    arrange: document.arrange,
    selectNode,
    requestFit,
  });
  const { focusNode, jumpToNode } = useGraphFocus({
    definition: rule.draft,
    ruleId: rule.id,
    requestedVersion,
    requestedNode,
    mode,
    unavailable: versionUnavailable,
    measurements,
    selectNode,
    selectEdge: setSelectedEdge,
    navigate,
  });
  const openReference = (target: ReferenceTarget) => {
    const shown = { ruleId: rule.id, version: requestedVersion };
    // The referenced-rule viewer needs explicit locations for this graph.
    const next = {
      ...target,
      problems: allProblems.map((problem) => ({
        ...problem,
        locations: problem.locations.map((location) =>
          isCurrentGraphLocation(location, shown)
            ? { ...location, ...shown }
            : location,
        ),
      })),
    };
    if (onOpenReference) onOpenReference(next, selected);
    else setReferenceTarget(next);
  };
  const openNodeEditor = (id: string) => {
    if (!can.edit || blockedByInvalidDefault("opening another node editor"))
      return;
    openEdit(id);
  };
  const renameNode = (id: string) => {
    if (!can.edit || !selectNode(id, "renaming another node")) return;
    setSelectedEdge(null);
    requestAnimationFrame(() => {
      const input = nodeNameInput.current;
      if (!input || input.disabled) return;
      input.focus();
      input.select();
    });
  };
  // One element for both views: the preview session itself lives in
  // usePreviewExecution, so remounting the panel with the view keeps it.
  const testPanel = preview.open && (
    <TestPanel
      preview={preview}
      ruleId={rule.id}
      version={requestedVersion}
      publishedVersion={requestedVersion ?? rule.publishedVersion}
      buildPending={sourceDirty}
      onOpenReference={openReference}
      onNode={jumpToNode}
    />
  );
  if (versionLoading)
    return (
      <div className="center-state">
        <CircularProgress size={25} />
        <p>Loading published version…</p>
      </div>
    );
  if (versionUnavailable)
    return (
      <div className="center-state">
        <Alert severity="error">
          Could not load version {requestedVersion}: {versionError}
        </Alert>
        <Button onClick={retryVersion}>Retry version</Button>
        {!embedded && (
          <Button onClick={() => navigate(`/rules/${rule.id}`)}>
            Open current draft
          </Button>
        )}
      </div>
    );
  return (
    <div className="editor">
      <EditorHeader
        rule={rule}
        mode={mode}
        readOnly={readOnly}
        dirty={dirty}
        busy={busy}
        capabilities={can}
        requestedVersion={requestedVersion}
        testOpen={preview.open}
        embedded={embedded}
        navigate={navigate}
        switchView={switchView}
        showHistory={() => setHistory((value) => !value)}
        setSettingsOpen={setSettingsOpen}
        action={action}
        onToggleTest={() => void toggleTest(preview.toggle)}
      />
      {error && (
        <Alert severity="error" onClose={() => setError("")}>
          {error}
        </Alert>
      )}
      {history && (
        <VersionHistory
          ruleId={rule.id}
          publishedVersion={rule.publishedVersion}
          navigate={navigate}
          onClose={() => setHistory(false)}
        />
      )}
      {view === "code" ? (
        <>
          <LazyBoundary
            label="code editor"
            fallback={
              <div className="center-state">
                <CircularProgress size={24} />
                <p>Loading code editor…</p>
              </div>
            }
          >
            {source !== null ? (
              <CodeStudio
                rule={rule}
                definition={rule.draft}
                source={source}
                onChange={editSource}
                diagnostics={diagnostics}
                readOnly={!can.edit}
                pending={sourceDirty}
                onBuild={build}
                onSave={() => void action("save")}
              />
            ) : (
              <div className="center-state">
                <CircularProgress size={24} />
              </div>
            )}
          </LazyBoundary>
          {testPanel}
        </>
      ) : (
        <div className="editor-body">
          <GraphCanvas
            definition={rule.draft}
            canvas={canvas}
            readOnly={readOnly}
            capabilities={can}
            arranging={busy === "layout"}
            selected={selected}
            selectedEdge={selectedEdge}
            setSelected={selectNode}
            setSelectedEdge={setSelectedEdge}
            focusNode={focusNode}
            edit={edit}
            layout={arrange}
            exportJson={() =>
              exportDefinition(rule.draft, rule.id, requestedVersion)
            }
            action={action}
            onAddNode={addNode}
            onEditNode={openNodeEditor}
            onRenameNode={renameNode}
            onDeleteNode={removeNode}
            hasTrace={!!preview.result}
          >
            {testPanel}
          </GraphCanvas>
          <Inspector
            rule={rule}
            node={node}
            rules={rules}
            readOnly={!can.edit || !!activeDialog}
            nameInputRef={nodeNameInput}
            onNodeChange={patchNode}
            onDelete={removeNode}
            onDefinitionChange={edit}
            onInvalidDefault={onInvalidDefault}
            errors={nodeErrors.get(selected) ?? noErrors}
            onExpression={openNodeCode}
            onOpenReference={openReference}
          />
        </div>
      )}
      {referenceTarget && (
        <ReferenceDialog
          target={referenceTarget}
          rules={rules}
          problems={allProblems}
          onClose={() => setReferenceTarget(null)}
        />
      )}
      {activeDialog?.request.kind === "edit" && (
        <LazyNodeDialog
          key={`edit:${activeDialog.node.id}`}
          label="node editor"
          onCancel={nodeDialog.close}
        >
          <NodeEditDialog
            rule={rule}
            nodeId={activeDialog.node.id}
            rules={rules}
            readOnly={!can.edit}
            onApply={edit}
            onClose={nodeDialog.close}
            onOpenReference={openReference}
          />
        </LazyNodeDialog>
      )}
      {activeDialog?.request.kind === "code" && (
        <LazyNodeDialog
          key={`code:${activeDialog.node.id}`}
          label="node code editor"
          onCancel={nodeDialog.close}
        >
          <NodeExpressionDialog
            definition={rule.draft}
            node={activeDialog.node}
            readOnly={!can.edit}
            onProblems={nodeDialog.reportCodeProblems}
            onApply={(built) => edit(() => built)}
            onClose={nodeDialog.close}
          />
        </LazyNodeDialog>
      )}
      {settingsOpen && (
        <RuleSettings
          rule={rule}
          readOnly={!can.edit}
          onClose={() => setSettingsOpen(false)}
          onApply={editMetadata}
          onDelete={onDeleted && !readOnly ? deleteRule : undefined}
          canDelete={can.delete}
        />
      )}
    </div>
  );
}
