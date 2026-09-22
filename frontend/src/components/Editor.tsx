import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { Alert, CircularProgress, Menu, MenuItem } from "@mui/material";
import { ReactFlowProvider } from "@xyflow/react";
import { ruleApi, errorMessage, type GraphProblem } from "../api";
import type { NodeType, RuleNode, Version } from "../types";
import { nodeLabel } from "../types";
import {
  createGraphNode,
  patchGraphNode,
  removeGraphNode,
} from "../domain/graph";
import { NodeIcon } from "./Icons";
import Inspector from "./Inspector";
import TestPanel from "./TestPanel";
import RuleSettings from "./RuleSettings";
import ReferenceDialog, { type ReferenceTarget } from "./ReferenceDialog";
import { useRuleDocument } from "../features/editor/useRuleDocument";
import { useGraphCanvas } from "../features/editor/useGraphCanvas";
import { useGraphProblems } from "../features/editor/useGraphProblems";
import EditorHeader from "../features/editor/EditorHeader";
import GraphCanvas from "../features/editor/GraphCanvas";
import VersionHistory from "../features/editor/VersionHistory";
import type { EditorProps } from "../features/editor/types";
const CodeStudio = lazy(() => import("./CodeStudio"));
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
  const [outline, setOutline] = useState(false);
  const [history, setHistory] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pendingFocus, setPendingFocus] = useState<string | null>(
    requestedNode || null,
  );
  const [versions, setVersions] = useState<Version[]>([]);
  const [addAnchor, setAddAnchor] = useState<HTMLElement | null>(null);
  const { allProblems, nodeErrors } = useGraphProblems({
    rule,
    version: requestedVersion,
    loading: versionLoading,
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
  const { flow, measurements } = canvas;
  const setTrace = useCallback(
    (trace: import("../types").Execution | null) =>
      dispatch({ type: "execution/completed", trace }),
    [],
  );
  const patchNode = (id: string, patch: Partial<RuleNode>) =>
    changeDefinition((definition) => patchGraphNode(definition, id, patch));
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
  const addNode = (type: NodeType) => {
    const position = flow.screenToFlowPosition({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    });
    const id = `node-${crypto.randomUUID().slice(0, 8)}`;
    changeDefinition((definition) => ({
      ...definition,
      nodes: [
        ...definition.nodes,
        createGraphNode(type, id, position, definition.nodes.length),
      ],
    }));
    setSelected(id);
    setAddAnchor(null);
  };
  const removeNode = (id: string) => {
    changeDefinition((definition) => removeGraphNode(definition, id));
    setSelected(
      rule.draft.nodes.find((node) => node.type === "INPUT")?.id ||
        rule.draft.nodes.find((node) => node.id !== id)?.id ||
        "",
    );
  };
  const layout = () =>
    runTask("layout", async () => {
      if (readOnly) return;
      const before = rule.draft;
      const { arrangeGraph } = await import("../graphLayout");
      const definition = await arrangeGraph(before, measurements);
      dispatch({ type: "graph/arranged", before, definition });
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
      await flow.fitView({ padding: 0.15, duration: 300 });
    });
  const focusNode = (id: string) => {
    setSelected(id);
    setSelectedEdge(null);
    const node = rule.draft.nodes.find((n) => n.id === id);
    if (node)
      void flow.setCenter(
        (node.position?.x ?? 0) + 115,
        (node.position?.y ?? 0) + 50,
        {
          zoom: 1,
          duration: 350,
        },
      );
  };
  const jumpToNode = (id: string) => {
    setSelected(id);
    setPendingFocus(id);
    if (mode === "code")
      navigate(
        `/rules/${rule.id}${requestedVersion ? `?version=${requestedVersion}` : ""}`,
      );
  };
  useEffect(() => {
    if (
      mode !== "graph" ||
      versionLoading ||
      !pendingFocus ||
      !measurements[pendingFocus]
    )
      return;
    const frame = requestAnimationFrame(() => {
      focusNode(pendingFocus);
      setPendingFocus(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [mode, versionLoading, pendingFocus, measurements]);
  const exportJson = () => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(rule.draft, null, 2)], {
        type: "application/json",
      }),
    );
    const a = window.document.createElement("a");
    a.href = url;
    a.download = `${rule.id}${requestedVersion ? `-v${requestedVersion}` : "-draft"}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const showHistory = async () => {
    setHistory((h) => !h);
    try {
      setVersions(await ruleApi.versions(rule.id));
    } catch (e) {
      setError(errorMessage(e));
    }
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
        showHistory={showHistory}
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
          versions={versions}
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
                rules={rules}
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
            outline={outline}
            setOutline={setOutline}
            focusNode={focusNode}
            changeDefinition={changeDefinition}
            layout={layout}
            exportJson={exportJson}
            action={action}
            onAddMenu={setAddAnchor}
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
      <Menu
        anchorEl={addAnchor}
        open={!!addAnchor}
        onClose={() => setAddAnchor(null)}
      >
        {(
          [
            "FORMULA",
            "CONDITION",
            "SWITCH",
            "TRANSFORM",
            "REFERENCE",
            "OUTPUT",
          ] as NodeType[]
        ).map((type) => (
          <MenuItem key={type} disabled={!!busy} onClick={() => addNode(type)}>
            <span className={`node-icon ${type.toLowerCase()}`}>
              <NodeIcon type={type} />
            </span>
            <span style={{ marginLeft: 10 }}>{nodeLabel[type]}</span>
          </MenuItem>
        ))}
      </Menu>
    </div>
  );
}
