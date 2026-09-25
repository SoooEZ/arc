import { lazy, Suspense, useCallback, useState } from "react";
import { Alert, Button, CircularProgress } from "@mui/material";
import { ReactFlowProvider } from "@xyflow/react";
import type { GraphProblem } from "../../api/errors";
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
import type { EditorProps, ReferenceTarget } from "./types";
const CodeStudio = lazy(() => import("../studio/CodeStudio"));
const NodeExpressionDialog = lazy(() => import("./NodeExpressionDialog"));
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
  navigate,
  notify,
  embedded = false,
  onOpenReference,
  initialProblems = [],
}: EditorProps) {
  const [runtimeProblems, setRuntimeProblems] = useState<GraphProblem[]>([]);
  const reportRuntimeError = useCallback(
    (problem: GraphProblem | null) =>
      setRuntimeProblems(problem ? [problem] : []),
    [],
  );
  const clearRuntime = useCallback(() => setRuntimeProblems([]), []);
  const document = useRuleDocument({
    initial,
    mode,
    requestedVersion,
    onSaved,
    onDirty,
    navigate,
    notify,
    reportRuntimeError,
  });
  const {
    rule,
    source,
    sourceDirty,
    diagnostics,
    trace,
    dispatch,
    readOnly,
    dirty,
    hasInvalidJson,
    onInvalidJson,
    changeDefinition,
    busy,
    runTask,
    error,
    setError,
    versionLoading,
    versionError,
    versionUnavailable,
    retryVersion,
    buildCode,
    build,
    switchView,
    action,
  } = document;
  const [selected, setSelected] = useState(
    initial.draft.nodes.find((node) => node.type === "CONDITION")?.id ||
      initial.draft.nodes[0].id,
  );
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [nodeCode, setNodeCode] = useState<string | null>(null);
  const [nodeCodeProblems, setNodeCodeProblems] = useState<string[]>([]);
  const [referenceTarget, setReferenceTarget] =
    useState<ReferenceTarget | null>(null);
  const [testOpen, setTestOpen] = useState(false);
  const [history, setHistory] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { allProblems, nodeErrors } = useGraphProblems({
    rule,
    version: requestedVersion,
    loading: versionUnavailable,
    invalidJson: hasInvalidJson,
    runtime: runtimeProblems,
    inherited: initialProblems,
    nodeCode,
    codeProblems: nodeCodeProblems,
    clearRuntime,
    onError: setError,
  });
  const canvas = useGraphCanvas({
    definition: rule.draft,
    selected,
    selectedEdge,
    setSelectedEdge,
    onExpression: setNodeCode,
    trace,
    nodeErrors,
    readOnly,
    busy,
    changeDefinition,
  });
  const { measurements } = canvas;
  const { patchNode, addNode, removeNode, arrange } = useGraphCommands({
    definition: rule.draft,
    measurements,
    readOnly,
    changeDefinition,
    dispatch,
    selectNode: setSelected,
    runTask,
  });
  const { focusNode, jumpToNode } = useGraphFocus({
    definition: rule.draft,
    ruleId: rule.id,
    requestedVersion,
    requestedNode,
    mode,
    unavailable: versionUnavailable,
    measurements,
    selectNode: setSelected,
    selectEdge: setSelectedEdge,
    navigate,
  });
  const setTrace = useCallback(
    (trace: import("../../types").Execution | null) =>
      dispatch({ type: "execution/completed", trace }),
    [],
  );
  const openReference = (target: ReferenceTarget) => {
    const next = {
      ...target,
      problems: allProblems.map((problem) => ({
        ...problem,
        locations: problem.locations.map((location) =>
          !location.ruleId || location.ruleId === "preview"
            ? { ...location, ruleId: rule.id, version: requestedVersion }
            : location,
        ),
      })),
    };
    if (onOpenReference) onOpenReference(next, selected);
    else setReferenceTarget(next);
  };
  const testPanel = testOpen && (
    <TestPanel
      definition={rule.draft}
      ruleId={rule.id}
      publishedVersion={requestedVersion || rule.publishedVersion}
      onResult={setTrace}
      onError={reportRuntimeError}
      onOpenReference={openReference}
      onNode={jumpToNode}
      onClose={() => setTestOpen(false)}
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
        requestedVersion={requestedVersion}
        testOpen={testOpen}
        embedded={embedded}
        navigate={navigate}
        switchView={switchView}
        showHistory={() => setHistory((value) => !value)}
        setSettingsOpen={setSettingsOpen}
        action={action}
        onToggleTest={() =>
          void runTask("test", async () => {
            await buildCode();
            setTestOpen((value) => !value);
          })
        }
      />
      {error && (
        <Alert severity="error" onClose={() => setError("")}>
          {error}
        </Alert>
      )}
      {history && (
        <VersionHistory
          ruleId={rule.id}
          navigate={navigate}
          onClose={() => setHistory(false)}
        />
      )}
      {mode === "code" || sourceDirty ? (
        <>
          <Suspense
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
                onChange={(source) =>
                  dispatch({ type: "source/changed", source })
                }
                diagnostics={diagnostics}
                readOnly={readOnly || !!busy}
                pending={sourceDirty}
                onBuild={build}
                onGraph={() => void switchView()}
                onSave={() => void action("save")}
              />
            ) : (
              <div className="center-state">
                <CircularProgress size={24} />
              </div>
            )}
          </Suspense>
          {!sourceDirty && testPanel}
        </>
      ) : (
        <div className="editor-body">
          <GraphCanvas
            definition={rule.draft}
            canvas={canvas}
            readOnly={readOnly}
            busy={busy}
            selected={selected}
            selectedEdge={selectedEdge}
            setSelected={setSelected}
            setSelectedEdge={setSelectedEdge}
            nodeErrors={nodeErrors}
            focusNode={focusNode}
            changeDefinition={changeDefinition}
            layout={arrange}
            exportJson={() =>
              exportDefinition(rule.draft, rule.id, requestedVersion)
            }
            action={action}
            onAddNode={addNode}
            hasTrace={!!trace}
          >
            {testPanel}
          </GraphCanvas>
          <Inspector
            rule={rule}
            node={
              rule.draft.nodes.find((n) => n.id === selected) ||
              rule.draft.nodes[0]
            }
            rules={rules}
            readOnly={readOnly || !!busy}
            onNodeChange={patchNode}
            onDelete={removeNode}
            onDefinitionChange={changeDefinition}
            onInvalidJson={onInvalidJson}
            errors={nodeErrors[selected] || []}
            onExpression={(id) => setNodeCode(id)}
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
      {nodeCode && rule.draft.nodes.some((n) => n.id === nodeCode) && (
        <Suspense fallback={null}>
          <NodeExpressionDialog
            key={nodeCode}
            definition={rule.draft}
            node={rule.draft.nodes.find((n) => n.id === nodeCode)!}
            readOnly={readOnly || !!busy}
            onProblems={setNodeCodeProblems}
            onApply={(d) => changeDefinition(() => d)}
            onClose={() => {
              setNodeCode(null);
              setNodeCodeProblems([]);
            }}
          />
        </Suspense>
      )}
      {settingsOpen && (
        <RuleSettings
          rule={rule}
          readOnly={readOnly || !!busy}
          onClose={() => setSettingsOpen(false)}
          onApply={(patch) => dispatch({ type: "rule/metadata", patch })}
        />
      )}
    </div>
  );
}
