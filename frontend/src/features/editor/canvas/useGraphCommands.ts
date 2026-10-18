import { useEffect, useRef } from "react";
import { useReactFlow, useStoreApi } from "@xyflow/react";
import type { Definition, NodeType, RuleNode } from "../../../types";
import type { LayoutDirection } from "../../../domain/nodePorts";
import type { FlowNode } from "./GraphNode";
import { cardSize, type NodeSize, type NodeSizes } from "./graphGeometry";
import { clearSpot, spotAfterExit, type Spot } from "./nodePlacement";
import {
  canRemoveGraphNode,
  connectGraphNodes,
  createGraphNode,
  patchGraphNode,
  removeGraphNode,
  type DefinitionChange,
} from "../../../domain/graph";
import { newId, shortId } from "../../../domain/ids";
import { canAddEdge, canAddNode } from "../../../domain/limits";
import type { DraftLayout } from "../document/useRuleDocument";

const unmeasured: NodeSizes = new Map();

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
  /** Left to right lays the cards out for display, so an added card is not revealed by its stored spot. */
  direction: LayoutDirection;
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
  direction,
}: Options) {
  const flow = useReactFlow<FlowNode>();
  const flowStore = useStoreApi();
  // The layout worker holds ELK's heap; it goes with the editor that loaded it.
  const layoutWorker = useRef<typeof import("./graphLayoutWorker") | null>(
    null,
  );
  useEffect(() => () => layoutWorker.current?.releaseLayoutWorker(), []);

  const patchNode = (id: string, patch: Partial<RuleNode>) =>
    edit((current) => patchGraphNode(current, id, patch));

  /** Pans to an added card the viewport does not show whole. */
  const reveal = (spot: Spot, size: NodeSize) => {
    if (direction !== "vertical") return;
    const { width, height, transform } = flowStore.getState();
    const [panX, panY, zoom] = transform;
    const left = -panX / zoom;
    const top = -panY / zoom;
    const shown =
      spot.x >= left &&
      spot.y >= top &&
      spot.x + size.width <= left + width / zoom &&
      spot.y + size.height <= top + height / zoom;
    // Nothing waits for the pan: an interrupted animation may never settle (F8).
    if (!shown)
      void flow.setCenter(spot.x + size.width / 2, spot.y + size.height / 2, {
        zoom,
        duration: 200,
      });
  };

  /** The size a new card of `type` has until it is measured. */
  const newCardSize = (type: NodeType) =>
    cardSize(
      createGraphNode(definition, type, "new", { x: 0, y: 0 }),
      unmeasured,
    );

  /** Adds a card of `type` in the middle of the visible canvas, clear of the cards there. */
  const addNode = (type: NodeType) => {
    // Entry points re-check what the toolbar shows: a full draft adds nothing.
    // The new node is selected, so a held selection refuses the whole command.
    if (!canAddNode(definition) || !mayChangeSelection("adding a node")) return;
    const size = newCardSize(type);
    const { width, height, transform } = flowStore.getState();
    const [panX, panY, zoom] = transform;
    const position = clearSpot(
      definition,
      measurements,
      {
        x: (width / 2 - panX) / zoom - size.width / 2,
        y: (height / 2 - panY) / zoom - size.height / 2,
      },
      size,
    );
    // Document updaters can run more than once, so the ID is chosen here.
    const id = shortId("node-");
    const added = edit((current) => ({
      ...current,
      nodes: [...current.nodes, createGraphNode(current, type, id, position)],
    }));
    if (!added) return;
    selectNode(id);
    reveal(position, size);
  };

  /** Adds a card of `type` below exit `handle` of `sourceId`, connected to it. */
  const addNodeAfter = (type: NodeType, sourceId: string, handle: string) => {
    const source = definition.nodes.find((node) => node.id === sourceId);
    if (
      !source ||
      !canAddNode(definition) ||
      !canAddEdge(definition) ||
      !mayChangeSelection("adding a node")
    )
      return;
    const size = newCardSize(type);
    const position = spotAfterExit(
      definition,
      measurements,
      source,
      handle,
      size,
    );
    const id = shortId("node-");
    const edgeId = newId();
    const added = edit((current) =>
      connectGraphNodes(
        {
          ...current,
          nodes: [
            ...current.nodes,
            createGraphNode(current, type, id, position),
          ],
        },
        sourceId,
        id,
        handle,
        edgeId,
      ),
    );
    if (!added) return;
    selectNode(id);
    reveal(position, size);
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

  return { patchNode, addNode, addNodeAfter, removeNode, arrange };
}
