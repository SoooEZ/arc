import { useCallback, useMemo, useState } from "react";
import {
  useReactFlow,
  type Connection,
  type EdgeChange,
  type NodeChange,
} from "@xyflow/react";
import type { Definition, Execution } from "../../types";
import type { FlowNode } from "../../components/GraphNode";
import { defaultNodeSize } from "../../graphGeometry";
import { connectGraphNodes, type DefinitionChange } from "../../domain/graph";
import { nodeWidth, sourcePorts } from "../../domain/nodePorts";
interface Options {
  definition: Definition;
  selected: string;
  selectedEdge: string | null;
  setSelectedEdge: (id: string | null) => void;
  onExpression: (id: string) => void;
  trace: Execution | null;
  nodeErrors: Record<string, string[]>;
  readOnly: boolean;
  busy: string;
  changeDefinition: (change: DefinitionChange) => void;
}
export function useGraphCanvas({
  definition,
  selected,
  selectedEdge,
  setSelectedEdge,
  onExpression,
  trace,
  nodeErrors,
  readOnly,
  busy,
  changeDefinition,
}: Options) {
  const flow = useReactFlow<FlowNode>();
  const [measurements, setMeasurements] = useState<
    Record<string, { width: number; height: number }>
  >({});
  const [blockedEdges, setBlockedEdges] = useState<Record<string, boolean>>({});
  const reportBlocked = useCallback((id: string, blocked: boolean) => {
    setBlockedEdges((current) => {
      if (!!current[id] === blocked) return current;
      const next = { ...current };
      if (blocked) next[id] = true;
      else delete next[id];
      return next;
    });
  }, []);
  const routing = useMemo(
    () => ({
      nodes: definition.nodes.map((n) => ({
        id: n.id,
        ...n.position,
        ...(measurements[n.id] || { ...defaultNodeSize, width: nodeWidth(n) }),
      })),
      reportBlocked,
    }),
    [definition.nodes, measurements, reportBlocked],
  );
  const visited = useMemo(
    () =>
      new Set(trace?.trace.filter((s) => s.depth === 0).map((s) => s.nodeId)),
    [trace],
  );
  const nodes: FlowNode[] = useMemo(
    () =>
      definition.nodes.map((n) => ({
        id: n.id,
        type: "arc",
        position: n.position || { x: 0, y: 0 },
        measured: measurements[n.id],
        style: { width: nodeWidth(n) },
        selected: n.id === selected,
        data: {
          model: n,
          visited: visited.has(n.id),
          inputCount: definition.inputs.length,
          errors: nodeErrors[n.id] || [],
          onExpression: () => onExpression(n.id),
        },
      })),
    [definition, selected, visited, measurements, nodeErrors, onExpression],
  );
  const edges = useMemo(
    () =>
      definition.edges.map((e) => {
        const active = !!trace?.trace.find(
          (s) =>
            s.depth === 0 &&
            s.nodeId === e.source &&
            s.branch === e.sourceHandle,
        );
        return {
          ...e,
          type: "routed",
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
            sourcePorts(
              definition.nodes.find((node) => node.id === e.source)!,
            ).find((port) => port.id === e.sourceHandle)?.label || undefined,
          labelStyle: {
            fill: e.sourceHandle === "false" ? "#956a4a" : "#47765d",
            fontSize: 10,
            fontWeight: 550,
          },
          labelBgStyle: { fill: "#f8faf8", fillOpacity: 1 },
          labelBgPadding: [5, 3] as [number, number],
        };
      }),
    [definition.edges, definition.nodes, selectedEdge, trace],
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
    changeDefinition((definition) =>
      connectGraphNodes(
        definition,
        connection.source!,
        connection.target!,
        connection.sourceHandle || "next",
        crypto.randomUUID(),
      ),
    );
  };
  return {
    flow,
    measurements,
    blockedEdges,
    routing,
    visited,
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    connect,
  };
}
