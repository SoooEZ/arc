import type { RuleNode } from "../../../types";
import {
  nodeMinHeight,
  nodeWidth,
  type LayoutDirection,
} from "../../../domain/nodePorts";

export interface NodeSize {
  width: number;
  height: number;
}
/** Measured card sizes by node ID; a Map, because node IDs such as "constructor" are legal. */
export type NodeSizes = ReadonlyMap<string, NodeSize>;

/** The height of a card before it is measured; its width comes from its exits (nodePorts). */
const defaultCardHeight = 105;

/**
 * A card's size: as measured, else its exit-driven width and the default
 * height, or the taller height its exits need along the right edge.
 */
export function cardSize(
  node: RuleNode,
  sizes: NodeSizes,
  direction: LayoutDirection = "vertical",
): NodeSize {
  const measured = sizes.get(node.id);
  return {
    width:
      measured && measured.width > 0
        ? measured.width
        : nodeWidth(node, direction),
    height:
      measured && measured.height > 0
        ? measured.height
        : Math.max(defaultCardHeight, nodeMinHeight(node, direction)),
  };
}

/** The point a viewport centres on to show the card whole. */
export function cardCenter(
  node: RuleNode,
  sizes: NodeSizes,
  direction: LayoutDirection = "vertical",
): { x: number; y: number } {
  const size = cardSize(node, sizes, direction);
  return {
    x: node.position.x + size.width / 2,
    y: node.position.y + size.height / 2,
  };
}

/** The zoom below which a card's text is too small to read. */
export const readableZoom = 0.5;

/** A card where the canvas draws it: its shown position and size. */
export interface PlacedCard extends NodeSize {
  id: string;
  x: number;
  y: number;
}

/** React Flow's viewport: the flow is drawn scaled by `zoom`, then moved by x and y. */
export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

/** The space above the first row (or beside the first column) of a graph opened at its start. */
const openingMargin = 40;

/**
 * Up to this many cards a graph always opens whole, however far apart they
 * sit: a few cards are the graph's structure, worth seeing at once.
 */
const fewCards = 12;

/**
 * Where a graph opens. Null means "fit every card", as React Flow's fitView
 * does with `padding`, which is right for a few cards and while that zoom
 * keeps text readable. A larger graph that would fit only below the readable
 * zoom opens at its start instead: its width (its
 * height when drawn left to right) fitted at a zoom between the readable one
 * and 1, the first row (column) after a small margin, and centred on the
 * entry card when even that width does not fit.
 */
export function openingViewport(
  cards: readonly PlacedCard[],
  entryId: string | undefined,
  view: NodeSize,
  direction: LayoutDirection,
  padding: number,
): Viewport | null {
  if (cards.length <= fewCards || view.width <= 0 || view.height <= 0)
    return null;
  const minX = Math.min(...cards.map((card) => card.x));
  const minY = Math.min(...cards.map((card) => card.y));
  const width = Math.max(...cards.map((card) => card.x + card.width)) - minX;
  const height = Math.max(...cards.map((card) => card.y + card.height)) - minY;
  const fitsAcross = view.width / (width * (1 + padding));
  const fitsAlong = view.height / (height * (1 + padding));
  if (Math.min(fitsAcross, fitsAlong) >= readableZoom) return null;
  const vertical = direction === "vertical";
  const zoom = Math.min(
    1,
    Math.max(readableZoom, vertical ? fitsAcross : fitsAlong),
  );
  const entry =
    cards.find((card) => card.id === entryId) ??
    cards.reduce((first, card) =>
      (vertical ? card.y < first.y : card.x < first.x) ? card : first,
    );
  // Across the reading direction: the whole graph centred when it fits,
  // else the entry card centred.
  const centred = (span: number, start: number, room: number, at: number) =>
    span * zoom <= room ? (room - span * zoom) / 2 - start * zoom : at;
  if (vertical)
    return {
      zoom,
      x: centred(
        width,
        minX,
        view.width,
        view.width / 2 - (entry.x + entry.width / 2) * zoom,
      ),
      y: openingMargin - minY * zoom,
    };
  return {
    zoom,
    x: openingMargin - minX * zoom,
    y: centred(
      height,
      minY,
      view.height,
      view.height / 2 - (entry.y + entry.height / 2) * zoom,
    ),
  };
}
