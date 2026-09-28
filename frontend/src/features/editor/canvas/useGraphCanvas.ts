import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Connection, Edge, EdgeChange, NodeChange } from "@xyflow/react";
import type { Definition, Execution } from "../../../types";
import type { FlowNode } from "./GraphNode";
import type { NodeSize, NodeSizes } from "./graphGeometry";
import {
  cardBounds,
  flowEdges,
  flowNodes,
  takenBranches,
} from "./flowElements";
import {
  connectGraphNodes,
  type DefinitionChange,
} from "../../../domain/graph";
import { newId } from "../../../domain/ids";
import type { NodeErrors } from "../useGraphProblems";
interface Options {
  definition: Definition;
  selected: string;
  selectedEdge: string | null;
  setSelectedEdge: (id: string | null) => void;
  onExpression: (id: string) => void;
  trace: Execution | null;
  nodeErrors: NodeErrors;
  /** The document's gated edit; dragging and connecting follow its rules. */
  edit: (change: DefinitionChange) => boolean;
}
export function useGraphCanvas({
  definition,
  selected,
  selectedEdge,
  setSelectedEdge,
  onExpression,
  trace,
  nodeErrors,
  edit,
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
  // Label and expression edits replace node objects without moving a card.
  // Keyed by geometry, the context keeps its identity, so edges do not re-route.
  const routing = useMemo(
    () => ({ nodes: bounds, reportBlocked }),
    [geometry, reportBlocked],
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
  const onEdgesChange = (changes: EdgeChange[]) => {
    for (const c of changes)
      if (c.type === "select" && c.selected) setSelectedEdge(c.id);
  };
  const connect = ({ source, target, sourceHandle }: Connection) => {
    if (!source || !target || source === target) return;
    // Document updaters can run more than once, so the ID is chosen here.
    const edgeId = newId();
    edit((definition) =>
      connectGraphNodes(
        definition,
        source,
        target,
        sourceHandle || "next",
        edgeId,
      ),
    );
  };
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
    connect,
  };
}
