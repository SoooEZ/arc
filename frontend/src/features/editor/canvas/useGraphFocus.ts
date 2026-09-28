import { useCallback, useEffect, useState } from "react";
import { useReactFlow } from "@xyflow/react";
import type { Definition } from "../../../types";
import type { FlowNode } from "./GraphNode";
import type { NodeSizes } from "./graphGeometry";

interface Options {
  definition: Definition;
  ruleId: string;
  requestedVersion: number | null;
  requestedNode?: string | null;
  mode: "graph" | "code";
  unavailable: boolean;
  measurements: NodeSizes;
  selectNode: (id: string) => boolean;
  selectEdge: (id: string | null) => void;
  navigate: (path: string) => void;
}

/** Delay error/deep-link focus until the graph and its measured node are visible. */
export function useGraphFocus({
  definition,
  ruleId,
  requestedVersion,
  requestedNode,
  mode,
  unavailable,
  measurements,
  selectNode,
  selectEdge,
  navigate,
}: Options) {
  const flow = useReactFlow<FlowNode>();
  const [pendingFocus, setPendingFocus] = useState(requestedNode || null);
  const focusNode = useCallback(
    (id: string) => {
      if (!selectNode(id)) return;
      selectEdge(null);
      const node = definition.nodes.find((candidate) => candidate.id === id);
      if (node)
        void flow.setCenter(node.position.x + 115, node.position.y + 50, {
          zoom: 1,
          duration: 350,
        });
    },
    [definition.nodes, flow, selectNode, selectEdge],
  );

  const jumpToNode = (id: string) => {
    if (!selectNode(id)) return;
    setPendingFocus(id);
    if (mode === "code")
      navigate(
        `/rules/${ruleId}${requestedVersion ? `?version=${requestedVersion}` : ""}`,
      );
  };

  useEffect(() => {
    if (
      mode !== "graph" ||
      unavailable ||
      !pendingFocus ||
      !measurements.has(pendingFocus)
    )
      return;
    const frame = requestAnimationFrame(() => {
      focusNode(pendingFocus);
      setPendingFocus(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [mode, unavailable, pendingFocus, measurements, focusNode]);

  return { focusNode, jumpToNode };
}
