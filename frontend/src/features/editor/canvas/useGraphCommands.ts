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
import type { DraftLayout } from "../useRuleDocument";

interface Options {
  definition: Definition;
  measurements: NodeSizes;
  /** The document's gated edit; false when it refused the change. */
  edit: (change: DefinitionChange) => boolean;
  /** The document's Arrange command. */
  arrange: (layout: DraftLayout, onArranged: () => void) => Promise<void>;
  selectNode: (id: string) => void;
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
  requestFit,
}: Options) {
  const flow = useReactFlow<FlowNode>();

  const patchNode = (id: string, patch: Partial<RuleNode>) =>
    edit((current) => patchGraphNode(current, id, patch));

  const addNode = (type: NodeType) => {
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

  const removeNode = (id: string) => {
    if (!canRemoveGraphNode(definition, id)) return;
    const next =
      definition.nodes.find((node) => node.type === "INPUT") ||
      definition.nodes.find((node) => node.id !== id);
    if (edit((current) => removeGraphNode(current, id)))
      selectNode(next?.id || "");
  };

  // The viewport fit after Arrange is optional presentation: the canvas may
  // unmount (a view switch) or the user may interrupt its animation, and
  // neither may keep the document locked (F8).
  const arrange = () =>
    arrangeDocument(async (draft) => {
      const { arrangeGraph } = await import("./graphLayout");
      return arrangeGraph(draft, measurements);
    }, requestFit);

  return { patchNode, addNode, removeNode, arrange };
}
