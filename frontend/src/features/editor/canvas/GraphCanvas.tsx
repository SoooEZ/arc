import { useState, type ReactNode } from "react";
import {
  Alert,
  Button,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
} from "@mui/material";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
} from "@xyflow/react";
import { Code2, Pencil, Trash2 } from "lucide-react";
import type { Definition, NodeType, RuleNode } from "../../../types";
import GraphNode from "./GraphNode";
import RoutedEdge, { RoutedConnectionLine, RoutingContext } from "./RoutedEdge";
import type { DefinitionChange } from "../../../domain/graph";
import type { useGraphCanvas } from "./useGraphCanvas";
import GraphToolbar from "./GraphToolbar";
import GraphOutline from "./GraphOutline";
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
  focusNode: (id: string) => void;
  changeDefinition: (change: DefinitionChange) => void;
  layout: () => Promise<void>;
  exportJson: () => void;
  action: (type: "validate") => Promise<void>;
  onAddNode: (type: NodeType) => void;
  onEditNode: (id: string) => void;
  onDeleteNode: (id: string) => void;
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
  focusNode,
  changeDefinition,
  layout,
  exportJson,
  action,
  onAddNode,
  onEditNode,
  onDeleteNode,
  hasTrace,
  children,
}: Props) {
  const [outline, setOutline] = useState(false);
  const [nodeMenu, setNodeMenu] = useState<{
    id: string;
    left: number;
    top: number;
  } | null>(null);
  const menuNode = definition.nodes.find((node) => node.id === nodeMenu?.id);
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
      <GraphToolbar
        nodeCount={definition.nodes.length}
        readOnly={readOnly}
        busy={busy}
        outline={outline}
        onToggleOutline={() => setOutline((value) => !value)}
        onArrange={layout}
        onExport={exportJson}
        onValidate={() => action("validate")}
        onAddNode={onAddNode}
      />
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
              setNodeMenu(null);
              setSelected(n.id);
              setSelectedEdge(null);
            }}
            onNodeContextMenu={(event, node) => {
              event.preventDefault();
              setNodeMenu({
                id: node.id,
                left: event.clientX,
                top: event.clientY,
              });
            }}
            onPaneClick={() => {
              setNodeMenu(null);
              setSelectedEdge(null);
            }}
            onPaneContextMenu={() => setNodeMenu(null)}
            onMoveStart={() => setNodeMenu(null)}
            onEdgeClick={(_, e) => {
              setNodeMenu(null);
              setSelectedEdge(e.id);
            }}
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
        <Menu
          open={!!nodeMenu && !!menuNode}
          onClose={() => setNodeMenu(null)}
          anchorReference="anchorPosition"
          anchorPosition={
            nodeMenu ? { left: nodeMenu.left, top: nodeMenu.top } : undefined
          }
          slotProps={{ list: { "aria-label": "Node actions" } }}
        >
          <MenuItem
            disabled={readOnly || !!busy}
            onClick={() => {
              if (!menuNode || readOnly || busy) return;
              setNodeMenu(null);
              onEditNode(menuNode.id);
            }}
          >
            <ListItemIcon>
              <Pencil size={16} />
            </ListItemIcon>
            <ListItemText>Edit</ListItemText>
          </MenuItem>
          <MenuItem
            disabled={readOnly || !!busy || menuNode?.type === "INPUT"}
            onClick={() => {
              if (!menuNode || readOnly || busy || menuNode.type === "INPUT")
                return;
              setNodeMenu(null);
              onDeleteNode(menuNode.id);
            }}
          >
            <ListItemIcon>
              <Trash2 size={16} />
            </ListItemIcon>
            <ListItemText>Delete</ListItemText>
          </MenuItem>
        </Menu>
        {outline && (
          <GraphOutline
            nodes={definition.nodes}
            selected={selected}
            onSelect={focusNode}
            onClose={() => setOutline(false)}
          />
        )}
        {selectedEdge && !readOnly && (
          <div className="edge-delete">
            <Button
              size="small"
              color="error"
              startIcon={<Trash2 size={14} />}
              disabled={!!busy}
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
