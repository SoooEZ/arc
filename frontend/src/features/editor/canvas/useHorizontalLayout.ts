import { useEffect, useMemo, useRef, useState } from "react";
import type { Definition, RuleNode } from "../../../types";
import {
  hasTargetPort,
  sourcePorts,
  type LayoutDirection,
} from "../../../domain/nodePorts";
import type { NodeSizes } from "./graphGeometry";

export type ShownPositions = ReadonlyMap<string, RuleNode["position"]>;

/**
 * What the left-to-right layout reads: each node's ID, handles and size, and
 * every connection. Positions, labels and expressions are not part of it, but
 * a label that changes a card's measured height is.
 */
function layoutKey(definition: Definition, sizes: NodeSizes): string {
  return JSON.stringify([
    definition.nodes.map((node) => {
      const size = sizes.get(node.id);
      return [
        node.id,
        hasTargetPort(node),
        sourcePorts(node).map((port) => port.id),
        size ? [size.width, size.height] : null,
      ];
    }),
    definition.edges.map((edge) => [
      edge.id,
      edge.source,
      edge.sourceHandle,
      edge.target,
    ]),
  ]);
}

/**
 * The connections ELK can place. An unfinished draft may keep one from a
 * handle its node no longer has, which Arrange refuses; the view draws the
 * rest and leaves that one for validation to report.
 */
function layoutable(definition: Definition): Definition {
  const nodes = new Map(definition.nodes.map((node) => [node.id, node]));
  return {
    ...definition,
    edges: definition.edges.filter((edge) => {
      const source = nodes.get(edge.source);
      const target = nodes.get(edge.target);
      return (
        !!source &&
        !!target &&
        hasTargetPort(target) &&
        sourcePorts(source).some((port) => port.id === edge.sourceHandle)
      );
    }),
  };
}

/** How long a layout waits for edits and card measurements to settle. */
const settleMs = 120;

/** The left-to-right view's latest layout, or why it failed. */
export interface HorizontalLayout {
  /** Null in the vertical view and until a horizontal view's first layout arrives. */
  positions: ShownPositions | null;
  /** The last layout's failure; the cards then keep the positions shown before it. */
  error: string | null;
}

/**
 * Where the left-to-right view draws each card: ELK lays the graph out again
 * whenever what it reads changes (layoutKey). The positions are for display
 * only: the draft keeps its stored top-to-bottom positions, so the view
 * neither changes nor dirties a rule. Only the latest request's layout or
 * failure is shown.
 */
export function useHorizontalLayout(
  definition: Definition,
  sizes: NodeSizes,
  direction: LayoutDirection,
): HorizontalLayout {
  const key = direction === "horizontal" ? layoutKey(definition, sizes) : null;
  // The layout reads the graph its key describes, without running again for
  // every new draft object.
  const latest = useRef({ definition, sizes });
  latest.current = { definition, sizes };
  const [laidOut, setLaidOut] = useState<HorizontalLayout>({
    positions: null,
    error: null,
  });
  // The layout worker holds ELK's heap; it goes with the canvas that loaded it.
  const worker = useRef<typeof import("./graphLayoutWorker") | null>(null);
  useEffect(() => () => worker.current?.releaseLayoutWorker(), []);
  useEffect(() => {
    if (key === null) return;
    let current = true;
    const timer = setTimeout(() => {
      const { definition, sizes } = latest.current;
      void Promise.all([import("./graphLayout"), import("./graphLayoutWorker")])
        .then(([{ arrangeGraph }, module]) => {
          worker.current = module;
          return arrangeGraph(
            layoutable(definition),
            sizes,
            module.layoutInWorker,
            "horizontal",
          );
        })
        .then(
          (arranged) => {
            if (current)
              setLaidOut({
                positions: new Map(
                  arranged.nodes.map((node) => [node.id, node.position]),
                ),
                error: null,
              });
          },
          // The next change lays the graph out again.
          (failure: unknown) => {
            if (current)
              setLaidOut((shown) => ({
                positions: shown.positions,
                error:
                  failure instanceof Error ? failure.message : String(failure),
              }));
          },
        );
    }, settleMs);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [key]);
  return direction === "horizontal" ? laidOut : vertical;
}

const vertical: HorizontalLayout = { positions: null, error: null };

/**
 * The draft as drawn: the shown positions over the stored ones. A card keeps
 * its node object while neither the node nor its shown position changes, so
 * React Flow renders only the cards that moved.
 */
export function useShownDefinition(
  definition: Definition,
  positions: ShownPositions | null,
): Definition {
  const shownNodes = useRef(new WeakMap<RuleNode, RuleNode>());
  return useMemo(() => {
    if (!positions) return definition;
    return {
      ...definition,
      nodes: definition.nodes.map((node) => {
        const position = positions.get(node.id);
        if (!position) return node;
        const earlier = shownNodes.current.get(node);
        if (earlier?.position === position) return earlier;
        const shown = { ...node, position };
        shownNodes.current.set(node, shown);
        return shown;
      }),
    };
  }, [definition, positions]);
}
