import { useCallback, useEffect, useState } from "react";
import { useReactFlow } from "@xyflow/react";
import type { Definition } from "../../../types";
import type { FlowNode } from "./GraphNode";
import { cardCenter, type NodeSizes } from "./graphGeometry";
import { rulePath } from "../../../app/routing";

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
  const [requestedFocus, setPendingFocus] = useState(requestedNode || null);
  // A deep link or a trace step may name a node the draft no longer has: such
  // a request is dropped, so it cannot hold every canvas mount unfitted.
  const pendingFocus =
    requestedFocus !== null &&
    definition.nodes.some((node) => node.id === requestedFocus)
      ? requestedFocus
      : null;
  const focusNode = useCallback(
    (id: string) => {
      if (!selectNode(id)) return;
      selectEdge(null);
      const node = definition.nodes.find((candidate) => candidate.id === id);
      if (!node) return;
      // The card's own centre: a wide Switch is centred, not cut at the right.
      const center = cardCenter(node, measurements);
      void flow.setCenter(center.x, center.y, { zoom: 1, duration: 350 });
    },
    [definition.nodes, measurements, flow, selectNode, selectEdge],
  );

  const jumpToNode = (id: string) => {
    if (!selectNode(id)) return;
    setPendingFocus(id);
    if (mode === "code")
      navigate(rulePath({ ruleId, version: requestedVersion }));
  };

  useEffect(() => {
    if (requestedFocus !== null && pendingFocus === null) setPendingFocus(null);
  }, [requestedFocus, pendingFocus]);

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

  // A canvas that mounts with a focus pending skips its initial fit (lesson F8):
  // the fit and the focus would otherwise race, whatever the frame order.
  return { focusNode, jumpToNode, focusPending: pendingFocus !== null };
}
