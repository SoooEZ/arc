import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Alert,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  Menu,
  MenuItem,
  Tooltip,
} from "@mui/material";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type EdgeChange,
  type NodeChange,
} from "@xyflow/react";
import {
  CheckCheck,
  ChevronDown,
  Clock3,
  Code2,
  Download,
  GitBranch,
  LayoutGrid,
  ListTree,
  Play,
  Plus,
  Save,
  Settings,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { api, ApiError, errorMessage, type GraphProblem } from "../api";
import type {
  Definition,
  Diagnostic,
  Execution,
  NodeType,
  Rule,
  RuleNode,
  Version,
} from "../types";
import { kindLabel, nodeLabel } from "../types";
import GraphNode, { type FlowNode } from "./GraphNode";
import { KindIcon, NodeIcon } from "./Icons";
import Inspector from "./Inspector";
import TestPanel from "./TestPanel";
import RuleSettings from "./RuleSettings";
import ReferenceDialog, { type ReferenceTarget } from "./ReferenceDialog";

const CodeStudio = lazy(() => import("./CodeStudio"));
const NodeExpressionDialog = lazy(() => import("./NodeExpressionDialog"));
const nodeTypes = { arc: GraphNode };
interface Props {
  mode: "code" | "graph";
  rule: Rule;
  rules: Rule[];
  requestedVersion: number | null;
  requestedNode?: string | null;
  onSaved: (r: Rule) => void;
  onDirty: (value: boolean) => void;
  navigate: (path: string) => void;
  notify: (message: string) => void;
  embedded?: boolean;
  onOpenReference?: (target: ReferenceTarget, fromNode?: string) => void;
  initialProblems?: GraphProblem[];
}
const snapshot = (r: Rule) => JSON.stringify([r.name, r.description, r.draft]);
export default function Editor(props: Props) {
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
  initialProblems,
}: Props) {
  const [rule, setRule] = useState(initial);
  const [invalidJson, setInvalidJson] = useState<Record<string, boolean>>({});
  const hasInvalidJson = Object.values(invalidJson).some(Boolean);
  const onInvalidJson = useCallback(
    (key: string, invalid: boolean) =>
      setInvalidJson((old) =>
        old[key] === invalid ? old : { ...old, [key]: invalid },
      ),
    [],
  );
  const [source, setSource] = useState<string | null>(null);
  const sourceValue = useRef(source);
  sourceValue.current = source;
  const [sourceDirty, setSourceDirty] = useState(false);
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const [baseline, setBaseline] = useState(snapshot(initial));
  const [selected, setSelected] = useState(
    initial.draft.nodes.find((n) => n.type === "CONDITION")?.id || "input",
  );
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [measurements, setMeasurements] = useState<
    Record<string, { width: number; height: number }>
  >({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [graphProblems, setGraphProblems] = useState<GraphProblem[]>([]);
  const [runtimeProblems, setRuntimeProblems] = useState<GraphProblem[]>([]);
  const [nodeCode, setNodeCode] = useState<string | null>(null);
  const [nodeCodeProblems, setNodeCodeProblems] = useState<string[]>([]);
  const [referenceTarget, setReferenceTarget] =
    useState<ReferenceTarget | null>(null);
  const reportRuntimeError = useCallback(
    (problem: GraphProblem | null) =>
      setRuntimeProblems(problem ? [problem] : []),
    [],
  );
  const openReference = (target: ReferenceTarget) =>
    onOpenReference
      ? onOpenReference(target, selected)
      : setReferenceTarget(target);
  const [testOpen, setTestOpen] = useState(false);
  const [trace, setTrace] = useState<Execution | null>(null);
  const [outline, setOutline] = useState(false);
  const [history, setHistory] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pendingFocus, setPendingFocus] = useState<string | null>(
    requestedNode || null,
  );
  const [versions, setVersions] = useState<Version[]>([]);
  const [addAnchor, setAddAnchor] = useState<HTMLElement | null>(null);
  const [versionLoading, setVersionLoading] = useState(!!requestedVersion);
  const flow = useReactFlow<FlowNode>();
  const readOnly = !!requestedVersion;
  const problemKey = JSON.stringify({
    ...rule.draft,
    nodes: rule.draft.nodes.map(({ position: _position, ...n }) => n),
  });
  useEffect(() => {
    if (versionLoading) return;
    let live = true;
    setRuntimeProblems([]);
    const timer = setTimeout(() => {
      api
        .diagnostics(rule.draft)
        .then((problems) => {
          if (live) setGraphProblems(problems);
        })
        .catch((e) => {
          if (live) setError(`Could not check graph: ${errorMessage(e)}`);
        });
    }, 350);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [problemKey, versionLoading]);
  const allProblems = [
    ...graphProblems,
    ...runtimeProblems,
    ...(initialProblems || []),
  ];
  const localProblems = [
    ...graphProblems,
    ...runtimeProblems,
    ...(initialProblems || []).map((problem) => ({
      ...problem,
      locations: problem.locations.filter(
        (l) => l.ruleId === rule.id && l.version === requestedVersion,
      ),
    })),
  ];
  const nodeErrors: Record<string, string[]> = {};
  for (const problem of localProblems)
    for (const location of problem.locations) {
      if (
        location.ruleId &&
        location.ruleId !== "preview" &&
        !(location.ruleId === rule.id && location.version === requestedVersion)
      )
        continue;
      (nodeErrors[location.nodeId] ||= []).push(problem.message);
    }
  if (hasInvalidJson) {
    const input = rule.draft.nodes.find((n) => n.type === "INPUT");
    if (input)
      (nodeErrors[input.id] ||= []).push(
        "Fix the invalid JSON parameter value.",
      );
  }
  if (nodeCode && nodeCodeProblems.length)
    (nodeErrors[nodeCode] ||= []).push(...nodeCodeProblems);
  for (const id of Object.keys(nodeErrors))
    nodeErrors[id] = [...new Set(nodeErrors[id])];
  const errorsKey = JSON.stringify(nodeErrors);
  const dirty =
    !readOnly && (hasInvalidJson || sourceDirty || snapshot(rule) !== baseline);
  useEffect(() => {
    onDirty(dirty);
  }, [dirty, onDirty]);
  useEffect(() => {
    if (!requestedVersion) return;
    let active = true;
    api
      .version(initial.id, requestedVersion)
      .then((v) => {
        if (active) setRule((r) => ({ ...r, draft: v.definition }));
      })
      .catch((e) => {
        if (active) setError(errorMessage(e));
      })
      .finally(() => {
        if (active) setVersionLoading(false);
      });
    return () => {
      active = false;
    };
  }, [initial.id, requestedVersion]);
  const changeDefinition = useCallback(
    (fn: (d: Definition) => Definition) => {
      if (readOnly) return;
      setRule((r) => ({ ...r, draft: fn(r.draft) }));
      setSource(null);
      setDiagnostics([]);
      setTrace(null);
      setError("");
    },
    [readOnly],
  );
  const patchNode = (id: string, patch: Partial<RuleNode>) =>
    changeDefinition((d) => ({
      ...d,
      nodes: d.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)),
    }));
  const visited = useMemo(
    () =>
      new Set(trace?.trace.filter((s) => s.depth === 0).map((s) => s.nodeId)),
    [trace],
  );
  const nodes: FlowNode[] = useMemo(
    () =>
      rule.draft.nodes.map((n) => ({
        id: n.id,
        type: "arc",
        position: n.position || { x: 0, y: 0 },
        measured: measurements[n.id],
        selected: n.id === selected,
        data: {
          model: n,
          visited: visited.has(n.id),
          inputCount: rule.draft.inputs.length,
          errors: nodeErrors[n.id] || [],
          onExpression: () => setNodeCode(n.id),
        },
      })),
    [rule.draft, selected, visited, measurements, errorsKey],
  );
  const edges = useMemo(
    () =>
      rule.draft.edges.map((e) => {
        const active = !!trace?.trace.find(
          (s) =>
            s.depth === 0 &&
            s.nodeId === e.source &&
            s.branch === e.sourceHandle,
        );
        return {
          ...e,
          type: "smoothstep",
          selected: selectedEdge === e.id,
          animated: active,
          style: {
            stroke: active
              ? "#278765"
              : e.sourceHandle === "false"
                ? "#b7a696"
                : "#a5b4ae",
            strokeWidth: active || selectedEdge === e.id ? 2.3 : 1.6,
          },
          label:
            e.sourceHandle === "next"
              ? undefined
              : e.sourceHandle === "true"
                ? "True"
                : "False",
          labelStyle: {
            fill: e.sourceHandle === "false" ? "#956a4a" : "#47765d",
            fontSize: 10,
            fontWeight: 550,
          },
          labelBgStyle: { fill: "#f8faf8", fillOpacity: 1 },
          labelBgPadding: [5, 3] as [number, number],
        };
      }),
    [rule.draft.edges, selectedEdge, trace],
  );
  const onNodesChange = useCallback(
    (changes: NodeChange<FlowNode>[]) => {
      const resized = changes.filter(
        (c) => c.type === "dimensions" && c.dimensions,
      );
      if (resized.length) {
        // React Flow's minimap reads measured user nodes. Keep these UI-only
        // measurements without changing the portable graph or dirtying a draft.
        setMeasurements((current) => {
          const next = { ...current };
          let changed = false;
          for (const c of resized)
            if (c.type === "dimensions" && c.dimensions) {
              if (
                next[c.id]?.width !== c.dimensions.width ||
                next[c.id]?.height !== c.dimensions.height
              ) {
                next[c.id] = c.dimensions;
                changed = true;
              }
            }
          return changed ? next : current;
        });
      }
      const moved = changes.filter((c) => c.type === "position" && c.position);
      if (!moved.length) return;
      changeDefinition((d) => ({
        ...d,
        nodes: d.nodes.map((n) => {
          const c = moved.find((c) => c.type === "position" && c.id === n.id);
          return c?.type === "position" && c.position
            ? { ...n, position: c.position }
            : n;
        }),
      }));
    },
    [changeDefinition],
  );
  const onEdgesChange = (changes: EdgeChange[]) => {
    for (const c of changes)
      if (c.type === "select" && c.selected) setSelectedEdge(c.id);
  };
  const connect = (connection: Connection) => {
    if (
      readOnly ||
      busy ||
      !connection.source ||
      !connection.target ||
      connection.source === connection.target
    )
      return;
    changeDefinition((d) => {
      const handle = connection.sourceHandle || "next";
      if (
        d.edges.some(
          (e) =>
            e.source === connection.source &&
            e.target === connection.target &&
            e.sourceHandle === handle,
        )
      )
        return d;
      return {
        ...d,
        edges: [
          ...d.edges,
          {
            id: crypto.randomUUID(),
            source: connection.source!,
            target: connection.target!,
            sourceHandle: handle,
          },
        ],
      };
    });
  };

  const buildCode = async (): Promise<Definition> => {
    if (hasInvalidJson)
      throw new Error(
        "Fix the invalid JSON default before saving or changing views",
      );
    if (!sourceDirty || source === null || readOnly) return rule.draft;
    const result = await api.build(source);
    setDiagnostics(result.diagnostics);
    if (!result.definition)
      throw new Error(
        result.diagnostics[0]?.message || "Code could not be built",
      );
    setRule((r) => ({ ...r, draft: result.definition! }));
    setSource(result.source);
    setSourceDirty(false);
    setTrace(null);
    return result.definition;
  };
  const build = async () => {
    setBusy("build");
    setError("");
    try {
      const draft = await buildCode();
      await api.validate(draft);
      notify("Code built. Graph is valid.");
    } catch (e) {
      setError(errorMessage(e));
      if (e instanceof ApiError)
        reportRuntimeError({ message: e.message, locations: e.locations });
    } finally {
      setBusy("");
    }
  };
  useEffect(() => {
    if (mode !== "code" || source !== null || versionLoading) return;
    let active = true;
    api
      .render(rule.draft)
      .then((r) => {
        if (active) setSource(r.source);
      })
      .catch((e) => {
        if (active) setError(errorMessage(e));
      });
    return () => {
      active = false;
    };
  }, [mode, source, rule.draft, versionLoading]);
  useEffect(() => {
    if (mode === "graph" && sourceDirty) {
      void buildCode().catch((e) => {
        setError(errorMessage(e));
        navigate(`/studio/${rule.id}`);
      });
    }
  }, [mode]); // A sidebar view switch also compiles before displaying the canvas.
  const switchView = async () => {
    if (busy) return;
    setBusy("switch");
    try {
      if (hasInvalidJson)
        throw new Error("Fix the invalid JSON default before changing views");
      if (mode === "code") await buildCode();
      navigate(
        `/${mode === "code" ? "rules" : "studio"}/${rule.id}${requestedVersion ? `?version=${requestedVersion}` : ""}`,
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy("");
    }
  };
  const save = async (candidate: Rule) => {
    const saved = await api.save(candidate);
    setRule(saved);
    setBaseline(snapshot(saved));
    onSaved(saved);
    return saved;
  };
  const action = async (type: string) => {
    if (busy) return;
    setBusy(type);
    setError("");
    try {
      const candidate = { ...rule, draft: await buildCode() };
      if (type === "save") {
        await save(candidate);
        notify("Draft saved");
      }
      if (type === "validate") {
        await api.validate(candidate.draft);
        notify("Graph is valid. All paths lead to a result.");
      }
      if (type === "publish") {
        await api.validate(candidate.draft);
        const saved =
          snapshot(candidate) !== baseline ? await save(candidate) : candidate;
        const published = await api.publish(saved.id, saved.revision);
        setRule(published);
        setBaseline(snapshot(published));
        onSaved(published);
        notify(
          `Version ${published.publishedVersion} published and ready to call`,
        );
      }
    } catch (e) {
      setError(errorMessage(e));
      if (e instanceof ApiError)
        reportRuntimeError({ message: e.message, locations: e.locations });
    } finally {
      setBusy("");
    }
  };
  const addNode = (type: NodeType) => {
    const position = flow.screenToFlowPosition({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    });
    const id = `node-${crypto.randomUUID().slice(0, 8)}`;
    changeDefinition((d) => ({
      ...d,
      nodes: [
        ...d.nodes,
        {
          id,
          type,
          label: type === "REFERENCE" ? "Reusable rule" : nodeLabel[type],
          position,
          expression:
            type === "CONDITION"
              ? "true"
              : type === "REFERENCE"
                ? undefined
                : type === "OUTPUT"
                  ? "0"
                  : "1 + 1",
          output:
            type === "FORMULA" || type === "REFERENCE"
              ? `result_${d.nodes.length}`
              : undefined,
          bindings: type === "REFERENCE" ? {} : undefined,
        },
      ],
    }));
    setSelected(id);
    setAddAnchor(null);
  };
  const removeNode = (id: string) => {
    changeDefinition((d) => ({
      ...d,
      nodes: d.nodes.filter((n) => n.id !== id || n.type === "INPUT"),
      edges: d.edges.filter((e) => e.source !== id && e.target !== id),
    }));
    setSelected("input");
  };
  const layout = async () => {
    if (readOnly || busy) return;
    setBusy("layout");
    setError("");
    const before = rule.draft;
    try {
      const { arrangeGraph } = await import("../graphLayout");
      const arranged = await arrangeGraph(before, measurements);
      // Preserve any edits made while the layout module was loading. A stale
      // result must not replace newly added/deleted nodes or edited expressions.
      setRule((current) =>
        current.draft === before ? { ...current, draft: arranged } : current,
      );
      setSource(null);
      setDiagnostics([]);
      setTrace(null);
      requestAnimationFrame(
        () => void flow.fitView({ padding: 0.15, duration: 300 }),
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy("");
    }
  };
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
    const a = document.createElement("a");
    a.href = url;
    a.download = `${rule.id}${requestedVersion ? `-v${requestedVersion}` : "-draft"}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const showHistory = async () => {
    setHistory((h) => !h);
    try {
      setVersions(await api.versions(rule.id));
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  if (versionLoading)
    return (
      <div className="center-state">
        <CircularProgress size={25} />
        <p>Loading published version…</p>
      </div>
    );
  return (
    <div className="editor">
      <div className="editor-heading">
        <div className="editor-title">
          <span className={`kind-icon ${rule.kind.toLowerCase()}`}>
            <KindIcon kind={rule.kind} />
          </span>
          <div>
            <div className="editor-name">
              <h1>{rule.name}</h1>
              <Tooltip title="Rule settings">
                <IconButton
                  aria-label="Rule settings"
                  size="small"
                  disabled={!!busy}
                  onClick={() => setSettingsOpen(true)}
                >
                  <Settings size={17} />
                </IconButton>
              </Tooltip>
              <Chip
                size="small"
                className={readOnly ? "published-chip" : "draft-chip"}
                label={readOnly ? `Version ${requestedVersion}` : "Draft"}
              />
            </div>
            <span>
              {kindLabel[rule.kind]}
              <span className="tiny-divider" />
              {dirty
                ? "Unsaved changes"
                : readOnly
                  ? "Immutable published version"
                  : "All changes saved"}
            </span>
          </div>
        </div>
        <div className="editor-actions">
          <Button
            startIcon={
              mode === "code" ? <GitBranch size={15} /> : <Code2 size={15} />
            }
            onClick={() => void switchView()}
            disabled={!!busy}
          >
            {mode === "code" ? "Graph view" : "Code editor"}
          </Button>
          <Tooltip title="Version history">
            <IconButton aria-label="Version history" onClick={showHistory}>
              <Clock3 size={18} />
            </IconButton>
          </Tooltip>
          <Button
            startIcon={<Play size={15} />}
            variant="outlined"
            disabled={!!busy}
            onClick={async () => {
              try {
                await buildCode();
                setTestOpen((v) => !v);
              } catch (e) {
                setError(errorMessage(e));
              }
            }}
          >
            {testOpen ? "Hide test" : "Test rule"}
          </Button>
          {!readOnly && (
            <>
              <Button
                startIcon={<Save size={15} />}
                variant="outlined"
                onClick={() => action("save")}
                disabled={!!busy || !dirty}
              >
                {busy === "save" ? "Saving…" : "Save draft"}
              </Button>
              <Button
                startIcon={<Upload size={15} />}
                variant="contained"
                onClick={() => action("publish")}
                disabled={!!busy}
              >
                {busy === "publish" ? "Publishing…" : "Publish"}
              </Button>
            </>
          )}
          {readOnly && !embedded && (
            <Button
              variant="contained"
              onClick={() => navigate(`/rules/${rule.id}`)}
            >
              Edit draft
            </Button>
          )}
        </div>
      </div>
      {error && (
        <Alert severity="error" onClose={() => setError("")}>
          {error}
        </Alert>
      )}
      {history && (
        <div className="version-bar">
          <Clock3 size={16} />
          <strong>Published versions</strong>
          {versions.length ? (
            versions.map((v) => (
              <button
                key={v.version}
                onClick={() =>
                  navigate(`/rules/${rule.id}?version=${v.version}`)
                }
              >
                v{v.version}
                <small>{new Date(v.publishedAt).toLocaleDateString()}</small>
              </button>
            ))
          ) : (
            <span>
              No published versions yet. Publish your first version to create a
              stable API.
            </span>
          )}
          <IconButton
            aria-label="Close history"
            onClick={() => setHistory(false)}
          >
            <X size={15} />
          </IconButton>
        </div>
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
                onChange={(value) => {
                  if (value === sourceValue.current) return;
                  sourceValue.current = value;
                  setSource(value);
                  setSourceDirty(true);
                  setDiagnostics([]);
                }}
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
          {testOpen && !sourceDirty && (
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
          )}
        </>
      ) : (
        <div className="editor-body">
          <div className="graph-workspace">
            <div className="graph-toolbar">
              <div className="graph-view-label">
                <GitBranch size={16} />
                <strong>Decision canvas</strong>
                <span>{rule.draft.nodes.length} nodes</span>
              </div>
              <div className="graph-tools">
                <Tooltip title="Node outline">
                  <IconButton
                    aria-label="Node outline"
                    onClick={() => setOutline((o) => !o)}
                    color={outline ? "primary" : "default"}
                  >
                    <ListTree size={17} />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Arrange graph · reduce crossings using True / False exit positions">
                  <span>
                    <IconButton
                      aria-label="Arrange graph"
                      disabled={readOnly || !!busy}
                      onClick={layout}
                    >
                      {busy === "layout" ? (
                        <CircularProgress size={16} />
                      ) : (
                        <LayoutGrid size={16} />
                      )}
                    </IconButton>
                  </span>
                </Tooltip>
                <Tooltip title="Export definition">
                  <IconButton
                    aria-label="Export definition"
                    onClick={exportJson}
                  >
                    <Download size={16} />
                  </IconButton>
                </Tooltip>
                <Button
                  size="small"
                  startIcon={<CheckCheck size={15} />}
                  onClick={() => action("validate")}
                  disabled={!!busy}
                >
                  Validate
                </Button>
                {!readOnly && (
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<Plus size={15} />}
                    endIcon={<ChevronDown size={13} />}
                    onClick={(e) => setAddAnchor(e.currentTarget)}
                  >
                    Add node
                  </Button>
                )}
              </div>
            </div>
            <div className="flow-container">
              <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onNodeClick={(_, n) => {
                  setSelected(n.id);
                  setSelectedEdge(null);
                }}
                onPaneClick={() => setSelectedEdge(null)}
                onEdgeClick={(_, e) => setSelectedEdge(e.id)}
                onConnect={connect}
                nodesDraggable={!readOnly && !busy}
                nodesConnectable={!readOnly && !busy}
                edgesReconnectable={false}
                deleteKeyCode={null}
                fitView
                fitViewOptions={{ padding: 0.18 }}
                minZoom={0.25}
                maxZoom={1.5}
                proOptions={{ hideAttribution: true }}
              >
                <Background
                  variant={BackgroundVariant.Dots}
                  gap={20}
                  size={1}
                  color="#cad5cf"
                />
                <Controls showInteractive={false} />
                <MiniMap
                  nodeColor={(n) =>
                    nodeErrors[n.id]?.length
                      ? "#d15a52"
                      : visited.has(n.id)
                        ? "#8ebda8"
                        : n.data?.model &&
                            (n.data.model as RuleNode).type === "CONDITION"
                          ? "#e8d8b2"
                          : "#d4dfd8"
                  }
                  maskColor="rgba(245,248,246,.7)"
                  pannable
                  zoomable
                />
              </ReactFlow>
              {outline && (
                <div className="node-outline">
                  <div>
                    <strong>Node outline</strong>
                    <IconButton
                      size="small"
                      aria-label="Close outline"
                      onClick={() => setOutline(false)}
                    >
                      <X size={14} />
                    </IconButton>
                  </div>
                  {rule.draft.nodes.map((n, i) => (
                    <button
                      key={n.id}
                      className={selected === n.id ? "selected" : ""}
                      onClick={() => focusNode(n.id)}
                    >
                      <small>{String(i + 1).padStart(2, "0")}</small>
                      <NodeIcon type={n.type} size={14} />
                      <span>{n.label}</span>
                    </button>
                  ))}
                </div>
              )}
              {selectedEdge && !readOnly && (
                <div className="edge-delete">
                  <Button
                    size="small"
                    color="error"
                    startIcon={<Trash2 size={14} />}
                    onClick={() => {
                      changeDefinition((d) => ({
                        ...d,
                        edges: d.edges.filter((e) => e.id !== selectedEdge),
                      }));
                      setSelectedEdge(null);
                    }}
                  >
                    Delete connection
                  </Button>
                </div>
              )}
              <div className="canvas-hint">
                {trace ? (
                  <>
                    <span className="status-dot published" />
                    Execution path highlighted
                  </>
                ) : (
                  <>
                    <span className="keyboard-key">⌘</span>Scroll to zoom
                    <span className="tiny-divider" />
                    Drag handles to connect
                  </>
                )}
              </div>
            </div>
            {testOpen && (
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
            )}
            <div className="editor-status">
              <span>
                <span className="status-dot published" />
                ARC engine
              </span>
              <span>
                {rule.draft.inputs.length} inputs
                <span className="tiny-divider" />
                {rule.draft.edges.length} connections
                <span className="tiny-divider" />
                <Code2 size={12} />
                Schema v{rule.draft.schemaVersion}
              </span>
            </div>
          </div>
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
            definition={rule.draft}
            node={rule.draft.nodes.find((n) => n.id === nodeCode)!}
            readOnly={readOnly}
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
          onApply={(patch) => setRule((r) => ({ ...r, ...patch }))}
        />
      )}
      <Menu
        anchorEl={addAnchor}
        open={!!addAnchor}
        onClose={() => setAddAnchor(null)}
      >
        {(["FORMULA", "CONDITION", "REFERENCE", "OUTPUT"] as NodeType[]).map(
          (type) => (
            <MenuItem key={type} onClick={() => addNode(type)}>
              <span className={`node-icon ${type.toLowerCase()}`}>
                <NodeIcon type={type} />
              </span>
              <span style={{ marginLeft: 10 }}>{nodeLabel[type]}</span>
            </MenuItem>
          ),
        )}
      </Menu>
    </div>
  );
}
