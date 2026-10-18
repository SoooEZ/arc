import type { Definition, RuleNode } from "../../../types";
import { sourcePort } from "../../../domain/nodePorts";
import { cardSize, type NodeSize, type NodeSizes } from "./graphGeometry";

/** A card's top-left corner in stored (top-to-bottom) flow coordinates. */
export interface Spot {
  x: number;
  y: number;
}

/** Space a new card keeps from every other card. */
const clearance = 24;
/** How far below its exit a card added after that exit starts. */
const stepBelowExit = 80;
/** The search tries this many columns to each side of the wanted spot, and this many rows below it. */
const searchColumns = 4;
const searchRows = 8;

interface Box extends Spot, NodeSize {}

/** Two cards crowd each other when they are closer than the clearance on both axes. */
function crowds(card: Box, candidate: Box): boolean {
  const gapX = Math.max(
    card.x - (candidate.x + candidate.width),
    candidate.x - (card.x + card.width),
  );
  const gapY = Math.max(
    card.y - (candidate.y + candidate.height),
    candidate.y - (card.y + card.height),
  );
  // Half a pixel of slack: fractional positions and sizes sum to a hair
  // below the clearance where they meet it exactly.
  return gapX < clearance - 0.5 && gapY < clearance - 0.5;
}

/**
 * The spot nearest `wanted` where a card of `size` keeps clear of every card
 * of the draft: the same row first, alternating between the `first` side and
 * the other, then each row below. A crowded graph without room nearby gets
 * `wanted` itself.
 */
export function clearSpot(
  definition: Definition,
  sizes: NodeSizes,
  wanted: Spot,
  size: NodeSize,
  first: "left" | "right" = "right",
): Spot {
  const toFirst = first === "right" ? 1 : -1;
  const cards: Box[] = definition.nodes.map((node) => ({
    ...node.position,
    ...cardSize(node, sizes),
  }));
  for (let row = 0; row <= searchRows; row++)
    for (let step = 0; step <= searchColumns * 2; step++) {
      // Columns 0, 1, -1, 2, -2 … towards the first side.
      const column = toFirst * (step % 2 ? (step + 1) / 2 : -step / 2);
      const spot = {
        x: Math.round(wanted.x + column * (size.width + clearance)),
        y: Math.round(wanted.y + row * (size.height + clearance)),
      };
      if (!cards.some((card) => crowds(card, { ...spot, ...size })))
        return spot;
    }
  return wanted;
}

/**
 * Where a card added after `source`'s exit `handle` goes: centred under that
 * exit, a step below the card, and clear of every other card, looking first
 * on the exit's own side so that a True branch does not cross over False.
 */
export function spotAfterExit(
  definition: Definition,
  sizes: NodeSizes,
  source: RuleNode,
  handle: string,
  size: NodeSize,
): Spot {
  const from = cardSize(source, sizes);
  const ratio = sourcePort(source, handle)?.ratio ?? 0.5;
  return clearSpot(
    definition,
    sizes,
    {
      x: source.position.x + from.width * ratio - size.width / 2,
      y: source.position.y + from.height + stepBelowExit,
    },
    size,
    ratio < 0.5 ? "left" : "right",
  );
}
