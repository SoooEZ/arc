import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  Connection,
  Edge,
  EdgeChange,
  FinalConnectionState,
  NodeChange,
} from "@xyflow/react";
import type { Definition, Execution } from "../../../types";
import type { FlowNode } from "./GraphNode";
import type { NodeSize, NodeSizes } from "./graphGeometry";
import {
  cardBounds,
  dragStartBounds,
  flowEdges,
  flowNodes,
  takenBranches,
  type CardBounds,
} from "./flowElements";
import type { MovedCard } from "./edgeRouting";
import {
  connectGraphNodes,
  connectionAllowed,
  type DefinitionChange,
} from "../../../domain/graph";
import { newId } from "../../../domain/ids";
import { canAddEdge, MAX_EDGES } from "../../../domain/limits";
import { handles } from "../../../domain/nodePorts";
import type { NodeErrors } from "../useGraphProblems";
interface Options {
  definition: Definition;
  selected: string;
  selectedEdge: string | null;
  setSelectedEdge: (id: string | null) => void;
  onExpression: (id: string) => void;
  /** Whether a card's node-code button opens now; a running command disables it. */
  canOpenCode: boolean;
  trace: Execution | null;
  nodeErrors: NodeErrors;
  /** The document's gated edit; dragging and connecting follow its rules. */
  edit: (change: DefinitionChange) => boolean;
  /** Told why a connection gesture was refused, e.g. the connection limit. */
  onRefused: (message: string) => void;
}
export function useGraphCanvas({
  definition,
  selected,
  selectedEdge,
  setSelectedEdge,
  onExpression,
  canOpenCode,
  trace,
  nodeErrors,
  edit,
  onRefused,
}: Options) {
  const [measurements, setMeasurements] = useState<NodeSizes>(() => new Map());
  const [blockedEdges, setBlockedEdges] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  // Counts viewport fits requested by commands. The mounted canvas performs
  // them, so no command waits for a viewport animation (lesson F8).
  const [fitRequest, setFitRequest] = useState(0);
  const requestFit = useCallback(
    () => setFitRequest((request) => request + 1),
    [],
  );
  const reportBlocked = useCallback((id: string, blocked: boolean) => {
    setBlockedEdges((current) => {
      if (current.has(id) === blocked) return current;
      const next = new Set(current);
      if (blocked) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);
  const bounds = cardBounds(definition.nodes, measurements);
  const geometry = JSON.stringify(bounds);
  // Handlers keep their identity for the canvas's lifetime and read the
  // latest draft and bounds through refs.
  const latest = useRef({ definition, bounds });
  latest.current = { definition, bounds };
  // The cards a drag in progress has moved: their bounds before the drag
  // started and now. Null between drags, so a settled graph routes fully.
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef<ReadonlyMap<string, CardBounds> | null>(null);
  const moved = useMemo((): MovedCard[] | null => {
    const before = dragging ? dragStart.current : null;
    if (!before) return null;
    const cards: MovedCard[] = [];
    for (const card of bounds) {
      const start = before.get(card.id);
      if (start && (start.x !== card.x || start.y !== card.y))
        cards.push({ id: card.id, before: start, after: card });
    }
    return cards;
    // The bounds are keyed by their geometry text.
  }, [dragging, geometry]);
  /** Ends a drag the canvas no longer reports, e.g. one its unmount interrupted. */
  const endDrag = useCallback(() => {
    dragStart.current = null;
    setDragging(false);
  }, []);
  // Label and expression edits replace node objects without moving a card.
  // Keyed by geometry, the context keeps its identity, so edges do not re-route.
  const routing = useMemo(
    () => ({ nodes: bounds, moved, reportBlocked }),
    [geometry, moved, reportBlocked],
  );
  const visited = useMemo(
    () =>
      new Set(trace?.trace.filter((s) => s.depth === 0).map((s) => s.nodeId)),
    [trace],
  );
  const taken = useMemo(() => takenBranches(trace), [trace]);
  const previousNodes = useRef<ReadonlyMap<string, FlowNode>>(new Map());
  const nodes = useMemo(
    () =>
      flowNodes(
        definition.nodes,
        {
          selected,
          visited,
          inputCount: definition.inputs.length,
          errors: nodeErrors,
          sizes: measurements,
          onExpression,
          canOpenCode,
        },
        previousNodes.current,
      ),
    [
      definition.nodes,
      definition.inputs.length,
      selected,
      visited,
      nodeErrors,
      measurements,
      onExpression,
      canOpenCode,
    ],
  );
  const previousEdges = useRef<ReadonlyMap<string, Edge>>(new Map());
  const edges = useMemo(
    () => flowEdges(definition, { selectedEdge, taken }, previousEdges.current),
    [definition, selectedEdge, taken],
  );
  useEffect(() => {
    previousNodes.current = new Map(nodes.map((node) => [node.id, node]));
    previousEdges.current = new Map(edges.map((edge) => [edge.id, edge]));
  }, [nodes, edges]);
  const onNodesChange = useCallback(
    (changes: NodeChange<FlowNode>[]) => {
      const resized = new Map<string, NodeSize>();
      for (const change of changes)
        if (change.type === "dimensions" && change.dimensions)
          resized.set(change.id, change.dimensions);
      if (resized.size) {
        // React Flow's minimap reads measured user nodes. Keep these UI-only
        // measurements without changing the portable graph or dirtying a draft.
        setMeasurements((current) => {
          let next: Map<string, NodeSize> | null = null;
          for (const [id, size] of resized) {
            const known = current.get(id);
            if (known?.width === size.width && known.height === size.height)
              continue;
            next ??= new Map(current);
            next.set(id, size);
          }
          return next ?? current;
        });
      }
      // A drag's first change carries the bounds before it: captured before
      // the edit below moves the cards, so the whole drag delta is routed.
      const start = dragStartBounds(
        dragStart.current,
        changes,
        latest.current.bounds,
      );
      if (start !== dragStart.current) {
        dragStart.current = start;
        setDragging(start !== null);
      }
      const moved = new Map<string, { x: number; y: number }>();
      for (const change of changes)
        if (change.type === "position" && change.position)
          moved.set(change.id, change.position);
      if (!moved.size) return;
      edit((d) => ({
        ...d,
        nodes: d.nodes.map((n) => {
          const position = moved.get(n.id);
          return position ? { ...n, position } : n;
        }),
      }));
    },
    [edit],
  );
  // Stable handlers: React Flow hands them to every memoized card and
  // connection, so a new function per render re-rendered the whole canvas.
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      for (const c of changes)
        if (c.type === "select" && c.selected) setSelectedEdge(c.id);
    },
    [setSelectedEdge],
  );
  /** Whether the dragged handle may drop here; React Flow shows a refused drop. */
  const isValidConnection = useCallback(
    (connection: Connection | Edge) =>
      connectionAllowed(latest.current.definition, {
        ...connection,
        sourceHandle: connection.sourceHandle || handles.next,
      }),
    [],
  );
  const connect = useCallback(
    ({ source, target, sourceHandle }: Connection) => {
      if (!source || !target || source === target) return;
      // Document updaters can run more than once, so the ID is chosen here.
      const edgeId = newId();
      edit((definition) =>
        connectGraphNodes(
          definition,
          source,
          target,
          sourceHandle || handles.next,
          edgeId,
        ),
      );
    },
    [edit],
  );
  /**
   * A drop on a handle the limit refused is explained. Every refusal shows while
   * the handle is dragged, and React Flow never calls onConnect for a refused
   * drop, so the explanation there was never reached.
   */
  const connectEnd = useCallback(
    (_event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
      if (
        state.isValid === false &&
        state.toHandle &&
        !canAddEdge(latest.current.definition)
      )
        onRefused(`A draft holds at most ${MAX_EDGES} connections`);
    },
    [onRefused],
  );
  return {
    measurements,
    blockedEdges,
    routing,
    nodes,
    edges,
    fitRequest,
    requestFit,
    onNodesChange,
    onEdgesChange,
    isValidConnection,
    connect,
    connectEnd,
    endDrag,
  };
}
