import type { ReactNode } from "react";
import {
  Alert,
  Button,
  CircularProgress,
  IconButton,
  Tooltip,
} from "@mui/material";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
} from "@xyflow/react";
import {
  CheckCheck,
  ChevronDown,
  Code2,
  Download,
  GitBranch,
  LayoutGrid,
  ListTree,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import type { Definition, RuleNode } from "../../types";
import GraphNode from "../../components/GraphNode";
import RoutedEdge, {
  RoutedConnectionLine,
  RoutingContext,
} from "../../components/RoutedEdge";
import { NodeIcon } from "../../components/Icons";
import type { DefinitionChange } from "../../domain/graph";
import type { useGraphCanvas } from "./useGraphCanvas";
const nodeTypes = { arc: GraphNode };
const edgeTypes = { routed: RoutedEdge };
interface Props {
  definition: Definition;
  canvas: ReturnType<typeof useGraphCanvas>;
  readOnly: boolean;
  busy: string;
  selected: string;
  selectedEdge: string | null;
  setSelected: (id: string) => void;
  setSelectedEdge: (id: string | null) => void;
  nodeErrors: Record<string, string[]>;
  outline: boolean;
  setOutline: (value: boolean | ((old: boolean) => boolean)) => void;
  focusNode: (id: string) => void;
  changeDefinition: (change: DefinitionChange) => void;
  layout: () => Promise<void>;
  exportJson: () => void;
  action: (type: "validate") => Promise<void>;
  onAddMenu: (element: HTMLElement) => void;
  hasTrace: boolean;
  children?: ReactNode;
}
export default function GraphCanvas({
  definition,
  canvas,
  readOnly,
  busy,
  selected,
  selectedEdge,
  setSelected,
  setSelectedEdge,
  nodeErrors,
  outline,
  setOutline,
  focusNode,
  changeDefinition,
  layout,
  exportJson,
  action,
  onAddMenu,
  hasTrace,
  children,
}: Props) {
  const {
    nodes,
    edges,
    routing,
    visited,
    blockedEdges,
    onNodesChange,
    onEdgesChange,
    connect,
  } = canvas;
  return (
    <div className="graph-workspace">
      <div className="graph-toolbar">
        <div className="graph-view-label">
          <GitBranch size={16} />
          <strong>Decision canvas</strong>
          <span>{definition.nodes.length} nodes</span>
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
          <Tooltip title="Arrange graph · reduce crossings using branch exit positions">
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
            <IconButton aria-label="Export definition" onClick={exportJson}>
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
              onClick={(e) => onAddMenu(e.currentTarget)}
            >
              Add node
            </Button>
          )}
        </div>
      </div>
      {definition.edges.some((e) => blockedEdges[e.id]) && (
        <Alert severity="warning" className="routing-warning">
          Connections blocked by overlapping or tightly spaced nodes. Move nodes
          apart or use Arrange graph:
          {definition.edges
            .filter((e) => blockedEdges[e.id])
            .map((e) => (
              <Button
                key={e.id}
                size="small"
                onClick={() => {
                  focusNode(e.source);
                  setSelectedEdge(e.id);
                }}
              >
                {definition.nodes.find((n) => n.id === e.source)?.label} →{" "}
                {definition.nodes.find((n) => n.id === e.target)?.label}
              </Button>
            ))}
        </Alert>
      )}
      <div className="flow-container">
        <RoutingContext.Provider value={routing}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            connectionLineComponent={RoutedConnectionLine}
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
        </RoutingContext.Provider>
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
            {definition.nodes.map((n, i) => (
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
          {hasTrace ? (
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
      {children}
      <div className="editor-status">
        <span>
          <span className="status-dot published" />
          ARC engine
        </span>
        <span>
          {definition.inputs.length} inputs
          <span className="tiny-divider" />
          {definition.edges.length} connections
          <span className="tiny-divider" />
          <Code2 size={12} />
          Schema v{definition.schemaVersion}
        </span>
      </div>
    </div>
  );
}
