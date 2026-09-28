import { useEffect, useRef } from "react";
import { useReactFlow } from "@xyflow/react";
import type { Definition, NodeType, RuleNode } from "../../../types";
import type { FlowNode } from "./GraphNode";
import type { NodeSizes } from "./graphGeometry";
import {
  canRemoveGraphNode,
  createGraphNode,
  patchGraphNode,
  removeGraphNode,
  type DefinitionChange,
} from "../../../domain/graph";
import { shortId } from "../../../domain/ids";
import { canAddNode } from "../../../domain/limits";
import type { DraftLayout } from "../useRuleDocument";

interface Options {
  definition: Definition;
  measurements: NodeSizes;
  /** The document's gated edit; false when it refused the change. */
  edit: (change: DefinitionChange) => boolean;
  /** The document's Arrange command. */
  arrange: (layout: DraftLayout, onArranged: () => void) => Promise<void>;
  selectNode: (id: string) => void;
  /** Whether the selection may change for `action` now (no invalid default holds it). */
  mayChangeSelection: (action: string) => boolean;
  /** Asks the mounted canvas to fit the viewport once it shows the new layout. */
  requestFit: () => void;
}

/** Graph mutations share the document's edit gate; only accepted edits move the selection. */
export function useGraphCommands({
  definition,
  measurements,
  edit,
  arrange: arrangeDocument,
  selectNode,
  mayChangeSelection,
  requestFit,
}: Options) {
  const flow = useReactFlow<FlowNode>();
  // The layout worker holds ELK's heap; it goes with the editor that loaded it.
  const layoutWorker = useRef<typeof import("./graphLayoutWorker") | null>(
    null,
  );
  useEffect(() => () => layoutWorker.current?.releaseLayoutWorker(), []);

  const patchNode = (id: string, patch: Partial<RuleNode>) =>
    edit((current) => patchGraphNode(current, id, patch));

  const addNode = (type: NodeType) => {
    // Entry points re-check what the toolbar shows: a full draft adds nothing.
    // The new node is selected, so a held selection refuses the whole command.
    if (!canAddNode(definition) || !mayChangeSelection("adding a node")) return;
    const position = flow.screenToFlowPosition({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    });
    const id = shortId("node-");
    const added = edit((current) => ({
      ...current,
      nodes: [...current.nodes, createGraphNode(current, type, id, position)],
    }));
    if (added) selectNode(id);
  };

  // Deleting only edits: the selection owner keeps an unrelated selection and
  // falls back to the default node when the selected node is gone.
  const removeNode = (id: string) => {
    if (canRemoveGraphNode(definition, id))
      edit((current) => removeGraphNode(current, id));
  };

  // The viewport fit after Arrange is optional presentation: the canvas may
  // unmount (a view switch) or the user may interrupt its animation, and
  // neither may keep the document locked (F8).
  const arrange = () =>
    arrangeDocument(async (draft) => {
      const [{ arrangeGraph }, worker] = await Promise.all([
        import("./graphLayout"),
        import("./graphLayoutWorker"),
      ]);
      layoutWorker.current = worker;
      return arrangeGraph(draft, measurements, worker.layoutInWorker);
    }, requestFit);

  return { patchNode, addNode, removeNode, arrange };
}
