import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Alert, Button } from "@mui/material";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  useReactFlow,
} from "@xyflow/react";
import { Code2, Trash2 } from "lucide-react";
import type { Definition, NodeType } from "../../../types";
import GraphNode, { type FlowNode } from "./GraphNode";
import RoutedEdge, { RoutedConnectionLine, RoutingContext } from "./RoutedEdge";
import {
  canRemoveGraphNode,
  type DefinitionChange,
} from "../../../domain/graph";
import { canAddNode } from "../../../domain/limits";
import { nodeKinds } from "../../../domain/nodeKinds";
import { sourcePort, type LayoutDirection } from "../../../domain/nodePorts";
import type { useGraphCanvas } from "./useGraphCanvas";
import type { EditorCapabilities } from "../document/editorCapabilities";
import GraphToolbar from "./GraphToolbar";
import GraphOutline from "./GraphOutline";
import NodeKindMenu from "./NodeKindMenu";
import CanvasContextMenu, { type CanvasMenuTarget } from "./CanvasContextMenu";
import { useCanvasShortcuts } from "./useCanvasShortcuts";
import { counted } from "../../../domain/text";
const nodeTypes = { arc: GraphNode };
const edgeTypes = { routed: RoutedEdge };
const initialFit = { padding: 0.18 };
const arrangedFit = { padding: 0.15, duration: 0 };
const proOptions = { hideAttribution: true };

/** The exit whose add button opened the kind menu. */
export interface ExitMenu {
  source: string;
  handle: string;
  anchor: HTMLElement;
}

/** Names the exit menu after the exit it adds to, e.g. "Add after Check · True". */
function exitMenuLabel(definition: Definition, menu: ExitMenu | null): string {
  if (!menu) return "Add after";
  const node = definition.nodes.find(
    (candidate) => candidate.id === menu.source,
  );
  const port = node && sourcePort(node, menu.handle);
  return `Add after ${node?.label ?? ""} · ${port?.label || "Next"}`;
}

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
  /** The exit menu a card's add button opened, if any. */
  exitMenu: ExitMenu | null;
  onCloseExitMenu: () => void;
  onAddAfter: (type: NodeType, source: string, handle: string) => void;
  /** Undo or Redo has a step to take now. */
  undoable: boolean;
  redoable: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onEditNode: (id: string) => void;
  onRenameNode: (id: string) => void;
  onDeleteNode: (id: string) => void;
  hasTrace: boolean;
  /** Top to bottom (stored positions, editable) or left to right (laid out for display). */
  direction: LayoutDirection;
  onDirectionChange: (direction: LayoutDirection) => void;
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
  exitMenu,
  onCloseExitMenu,
  onAddAfter,
  undoable,
  redoable,
  onUndo,
  onRedo,
  onEditNode,
  onRenameNode,
  onDeleteNode,
  hasTrace,
  direction,
  onDirectionChange,
  children,
}: Props) {
  const [outline, setOutline] = useState(false);
  const [contextMenu, setContextMenu] = useState<CanvasMenuTarget | null>(null);
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
    layoutReady,
    layoutError,
    fitRequest,
    onNodesChange,
    onEdgesChange,
    isValidConnection,
    connect,
    connectEnd,
    endDrag,
  } = canvas;
  const flow = useReactFlow<FlowNode>();
  const canvasArea = useRef<HTMLDivElement>(null);
  // Keys read the latest selection and commands through a ref, so the
  // document listener stays registered while the selection changes.
  const deletion = useRef({
    can,
    definition,
    selected,
    selectedEdge,
    removeEdge,
    onDeleteNode,
  });
  deletion.current = {
    can,
    definition,
    selected,
    selectedEdge,
    removeEdge,
    onDeleteNode,
  };
  const deleteSelection = useCallback((cards: boolean) => {
    const latest = deletion.current;
    if (!latest.can.edit) return false;
    if (latest.selectedEdge) {
      latest.removeEdge(latest.selectedEdge);
      return true;
    }
    if (!cards || !canRemoveGraphNode(latest.definition, latest.selected))
      return false;
    latest.onDeleteNode(latest.selected);
    return true;
  }, []);
  useCanvasShortcuts({
    workspace: canvasArea,
    enabled: !readOnly,
    undo: onUndo,
    redo: onRedo,
    deleteSelection,
  });
  // A drag the previous canvas was reporting ended with it: the settled graph
  // routes fully again instead of waiting for a drag end that never comes.
  useEffect(() => {
    endDrag();
  }, [endDrag]);
  // The selection setters change identity with the selection; React Flow
  // hands these handlers to every memoized card, so they read the latest ones
  // through a ref and keep their own identity for the canvas's lifetime.
  const latestSelection = useRef({ setSelected, setSelectedEdge });
  latestSelection.current = { setSelected, setSelectedEdge };
  const handlers = useMemo(() => {
    const closeMenu = () => setContextMenu(null);
    const menuAt = (
      kind: "node" | "edge",
      id: string,
      event: { clientX: number; clientY: number; preventDefault: () => void },
    ) => {
      event.preventDefault();
      setContextMenu({ kind, id, left: event.clientX, top: event.clientY });
    };
    return {
      closeMenu,
      onNodeClick: (_: unknown, node: { id: string }) => {
        closeMenu();
        latestSelection.current.setSelected(node.id);
        latestSelection.current.setSelectedEdge(null);
      },
      onNodeContextMenu: (
        event: { clientX: number; clientY: number; preventDefault: () => void },
        node: { id: string },
      ) => menuAt("node", node.id, event),
      onPaneClick: () => {
        closeMenu();
        latestSelection.current.setSelectedEdge(null);
      },
      onEdgeClick: (_: unknown, edge: { id: string }) => {
        closeMenu();
        latestSelection.current.setSelectedEdge(edge.id);
      },
      onEdgeContextMenu: (
        event: { clientX: number; clientY: number; preventDefault: () => void },
        edge: { id: string },
      ) => menuAt("edge", edge.id, event),
    };
  }, []);
  // Decided once per mount: React Flow would otherwise fit on a later node
  // measurement once the pending focus has cleared and the prop turns true.
  const [fitOnMount] = useState(!initialFocus);
  // React Flow fits the cards it first measures, which a left-to-right view
  // draws at their stored positions until its layout arrives: that view fits
  // once laid out instead, and so does every change of direction.
  const [fitViewOnMount] = useState(fitOnMount && direction === "vertical");
  const directionFit = useRef({
    direction,
    pending: fitOnMount && direction === "horizontal",
  });
  useEffect(() => {
    const fit = directionFit.current;
    if (fit.direction !== direction) {
      fit.direction = direction;
      fit.pending = true;
    }
    if (!fit.pending || !layoutReady) return;
    const frame = requestAnimationFrame(() => {
      fit.pending = false;
      // Nothing awaits the fit: an interrupted fit may never settle.
      void flow.fitView(arrangedFit);
    });
    return () => cancelAnimationFrame(frame);
  }, [direction, layoutReady, flow]);
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
        canAddNode={canAddNode(definition)}
        readOnly={readOnly}
        capabilities={can}
        arranging={arranging}
        direction={direction}
        onDirectionChange={onDirectionChange}
        outline={outline}
        onToggleOutline={() => setOutline((value) => !value)}
        onArrange={layout}
        onExport={exportJson}
        onValidate={() => action("validate")}
        onAddNode={onAddNode}
        undoable={undoable}
        redoable={redoable}
        onUndo={onUndo}
        onRedo={onRedo}
      />
      {layoutError && (
        <Alert severity="warning" className="routing-warning">
          The left-to-right view could not be laid out: {layoutError} Cards stay
          where they were drawn.
        </Alert>
      )}
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
      <div
        ref={canvasArea}
        className={`flow-container ${layoutReady ? "" : "flow-laying-out"}`}
      >
        <RoutingContext.Provider value={routing}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            connectionLineComponent={RoutedConnectionLine}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={handlers.onNodeClick}
            onNodeContextMenu={handlers.onNodeContextMenu}
            onPaneClick={handlers.onPaneClick}
            onPaneContextMenu={handlers.closeMenu}
            onMoveStart={handlers.closeMenu}
            onEdgeClick={handlers.onEdgeClick}
            onEdgeContextMenu={handlers.onEdgeContextMenu}
            onConnect={connect}
            onConnectEnd={connectEnd}
            isValidConnection={isValidConnection}
            // A left-to-right view lays itself out; cards move top to bottom.
            nodesDraggable={can.edit && direction === "vertical"}
            nodesConnectable={can.edit}
            edgesReconnectable={false}
            deleteKeyCode={null}
            fitView={fitViewOnMount}
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
        <CanvasContextMenu
          target={contextMenu}
          definition={definition}
          canEdit={can.edit}
          onClose={() => setContextMenu(null)}
          onRenameNode={onRenameNode}
          onEditNode={onEditNode}
          onDeleteNode={onDeleteNode}
          onDeleteEdge={removeEdge}
        />
        <NodeKindMenu
          anchor={exitMenu?.anchor ?? null}
          label={exitMenuLabel(definition, exitMenu)}
          disabled={!can.edit}
          onChoose={(type) => {
            if (exitMenu) onAddAfter(type, exitMenu.source, exitMenu.handle);
          }}
          onClose={onCloseExitMenu}
        />
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
          {counted(definition.inputs.length, "input")}
          <span className="tiny-divider" />
          {counted(definition.edges.length, "connection")}
          <span className="tiny-divider" />
          <Code2 size={12} />
          Schema v{definition.schemaVersion}
        </span>
      </div>
    </div>
  );
}
