import { useEffect, useRef, useState, type ReactNode } from "react";
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
  useReactFlow,
} from "@xyflow/react";
import { Code2, Pencil, TextCursorInput, Trash2 } from "lucide-react";
import type { Definition, NodeType } from "../../../types";
import GraphNode, { type FlowNode } from "./GraphNode";
import RoutedEdge, { RoutedConnectionLine, RoutingContext } from "./RoutedEdge";
import {
  canRemoveGraphNode,
  type DefinitionChange,
} from "../../../domain/graph";
import { nodeKinds } from "../../../domain/nodeKinds";
import type { useGraphCanvas } from "./useGraphCanvas";
import type { EditorCapabilities } from "../editorCapabilities";
import GraphToolbar from "./GraphToolbar";
import GraphOutline from "./GraphOutline";
const nodeTypes = { arc: GraphNode };
const edgeTypes = { routed: RoutedEdge };
const initialFit = { padding: 0.18 };
const arrangedFit = { padding: 0.15, duration: 0 };
const proOptions = { hideAttribution: true };

function minimapColor(node: FlowNode): string {
  if (node.data.errors.length) return "#d15a52";
  if (node.data.visited) return "#8ebda8";
  return nodeKinds[node.data.model.type].minimapColor;
}
interface Props {
  definition: Definition;
  canvas: ReturnType<typeof useGraphCanvas>;
  /** A published version: no editing controls are offered. */
  readOnly: boolean;
  capabilities: EditorCapabilities;
  /** Arrange is running. */
  arranging: boolean;
  /** A node focus waits for this mount: the initial fit is skipped in its favor. */
  initialFocus: boolean;
  selected: string;
  selectedEdge: string | null;
  setSelected: (id: string) => void;
  setSelectedEdge: (id: string | null) => void;
  focusNode: (id: string) => void;
  /** The document's gated edit; false when it refused the change. */
  edit: (change: DefinitionChange) => boolean;
  layout: () => Promise<void>;
  exportJson: () => void;
  action: (type: "validate") => Promise<void>;
  onAddNode: (type: NodeType) => void;
  onEditNode: (id: string) => void;
  onRenameNode: (id: string) => void;
  onDeleteNode: (id: string) => void;
  hasTrace: boolean;
  children?: ReactNode;
}
export default function GraphCanvas({
  definition,
  canvas,
  readOnly,
  capabilities: can,
  arranging,
  initialFocus,
  selected,
  selectedEdge,
  setSelected,
  setSelectedEdge,
  focusNode,
  edit,
  layout,
  exportJson,
  action,
  onAddNode,
  onEditNode,
  onRenameNode,
  onDeleteNode,
  hasTrace,
  children,
}: Props) {
  const [outline, setOutline] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    kind: "node" | "edge";
    id: string;
    left: number;
    top: number;
  } | null>(null);
  const menuNode =
    contextMenu?.kind === "node"
      ? definition.nodes.find((node) => node.id === contextMenu.id)
      : undefined;
  const menuEdge =
    contextMenu?.kind === "edge"
      ? definition.edges.find((edge) => edge.id === contextMenu.id)
      : undefined;
  const menuTargetRemovable = menuNode
    ? canRemoveGraphNode(definition, menuNode.id)
    : !!menuEdge;
  const deleteMenuTarget = () => {
    setContextMenu(null);
    if (menuNode) onDeleteNode(menuNode.id);
    else if (menuEdge) removeEdge(menuEdge.id);
  };
  // The selection follows the draft: a removed connection is no longer selected.
  const removeEdge = (id: string) => {
    edit((current) => {
      if (!current.edges.some((edge) => edge.id === id)) return current;
      return {
        ...current,
        edges: current.edges.filter((edge) => edge.id !== id),
      };
    });
  };
  const {
    nodes,
    edges,
    routing,
    blockedEdges,
    fitRequest,
    onNodesChange,
    onEdgesChange,
    connect,
  } = canvas;
  const flow = useReactFlow<FlowNode>();
  // Decided once per mount: React Flow would otherwise fit on a later node
  // measurement once the pending focus has cleared and the prop turns true.
  const [fitOnMount] = useState(!initialFocus);
  // Fit requests made while this canvas was unmounted were covered by the
  // initial fit, so only requests made while it is mounted run here.
  const handledFit = useRef(fitRequest);
  useEffect(() => {
    if (handledFit.current === fitRequest) return;
    const frame = requestAnimationFrame(() => {
      handledFit.current = fitRequest;
      // Nothing awaits the fit: an interrupted fit may never settle.
      void flow.fitView(arrangedFit);
    });
    return () => cancelAnimationFrame(frame);
  }, [fitRequest, flow]);
  const blocked = definition.edges.filter((edge) => blockedEdges.has(edge.id));
  return (
    <div className="graph-workspace">
      <GraphToolbar
        nodeCount={definition.nodes.length}
        readOnly={readOnly}
        capabilities={can}
        arranging={arranging}
        outline={outline}
        onToggleOutline={() => setOutline((value) => !value)}
        onArrange={layout}
        onExport={exportJson}
        onValidate={() => action("validate")}
        onAddNode={onAddNode}
      />
      {!!blocked.length && (
        <Alert severity="warning" className="routing-warning">
          Connections blocked by overlapping or tightly spaced nodes. Move nodes
          apart or use Arrange graph:
          {blocked.map((e) => (
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
              setContextMenu(null);
              setSelected(n.id);
              setSelectedEdge(null);
            }}
            onNodeContextMenu={(event, node) => {
              event.preventDefault();
              setContextMenu({
                kind: "node",
                id: node.id,
                left: event.clientX,
                top: event.clientY,
              });
            }}
            onPaneClick={() => {
              setContextMenu(null);
              setSelectedEdge(null);
            }}
            onPaneContextMenu={() => setContextMenu(null)}
            onMoveStart={() => setContextMenu(null)}
            onEdgeClick={(_, e) => {
              setContextMenu(null);
              setSelectedEdge(e.id);
            }}
            onEdgeContextMenu={(event, edge) => {
              event.preventDefault();
              setContextMenu({
                kind: "edge",
                id: edge.id,
                left: event.clientX,
                top: event.clientY,
              });
            }}
            onConnect={connect}
            nodesDraggable={can.edit}
            nodesConnectable={can.edit}
            edgesReconnectable={false}
            deleteKeyCode={null}
            fitView={fitOnMount}
            fitViewOptions={initialFit}
            minZoom={0.25}
            maxZoom={1.5}
            proOptions={proOptions}
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={20}
              size={1}
              color="#cad5cf"
            />
            <Controls showInteractive={false} />
            <MiniMap<FlowNode>
              nodeColor={minimapColor}
              maskColor="rgba(245,248,246,.7)"
              pannable
              zoomable
            />
          </ReactFlow>
        </RoutingContext.Provider>
        <Menu
          open={!!contextMenu && (!!menuNode || !!menuEdge)}
          onClose={() => setContextMenu(null)}
          anchorReference="anchorPosition"
          anchorPosition={
            contextMenu
              ? { left: contextMenu.left, top: contextMenu.top }
              : undefined
          }
          slotProps={{
            list: {
              "aria-label":
                contextMenu?.kind === "edge"
                  ? "Connection actions"
                  : "Node actions",
            },
          }}
        >
          {menuNode && (
            <MenuItem
              disabled={!can.edit}
              onClick={() => {
                setContextMenu(null);
                onRenameNode(menuNode.id);
              }}
            >
              <ListItemIcon>
                <TextCursorInput size={16} />
              </ListItemIcon>
              <ListItemText>Rename</ListItemText>
            </MenuItem>
          )}
          {menuNode && (
            <MenuItem
              disabled={!can.edit}
              onClick={() => {
                setContextMenu(null);
                onEditNode(menuNode.id);
              }}
            >
              <ListItemIcon>
                <Pencil size={16} />
              </ListItemIcon>
              <ListItemText>Edit</ListItemText>
            </MenuItem>
          )}
          <MenuItem
            disabled={!can.edit || !menuTargetRemovable}
            onClick={deleteMenuTarget}
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
              disabled={!can.edit}
              onClick={() => removeEdge(selectedEdge)}
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
