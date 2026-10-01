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
  const [requestedFocus, setRequestedFocus] = useState(requestedNode || null);
  // A link to another node of the open graph (?node=) asks again: the editor
  // stays mounted for the same rule and version, so its first request was all
  // it read.
  const [linkedNode, setLinkedNode] = useState(requestedNode);
  if (requestedNode !== linkedNode) {
    setLinkedNode(requestedNode);
    if (requestedNode) setRequestedFocus(requestedNode);
  }
  // A deep link or a trace step may name a node the graph does not have: such
  // a request is dropped, so it cannot hold every canvas mount unfitted. It is
  // judged by the graph it names, so not while a pinned version loads: the
  // draft shown meanwhile may lack a node only that version has.
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

  // Stable while the graph changes, so views such as the Test panel's trace,
  // which re-render only for a new handler, stay put while a card is dragged.
  const jumpToNode = useCallback(
    (id: string) => {
      if (!selectNode(id)) return;
      setRequestedFocus(id);
      if (mode === "code")
        navigate(rulePath({ ruleId, version: requestedVersion }));
    },
    [selectNode, mode, navigate, ruleId, requestedVersion],
  );

  useEffect(() => {
    if (!unavailable && requestedFocus !== null && pendingFocus === null)
      setRequestedFocus(null);
  }, [unavailable, requestedFocus, pendingFocus]);

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
      setRequestedFocus(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [mode, unavailable, pendingFocus, measurements, focusNode]);

  // A canvas that mounts with a focus pending skips its initial fit (lesson F8):
  // the fit and the focus would otherwise race, whatever the frame order.
  return { focusNode, jumpToNode, focusPending: pendingFocus !== null };
}
