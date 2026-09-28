import type { RuleNode } from "../../../types";
import { nodeWidth } from "../../../domain/nodePorts";

export interface NodeSize {
  width: number;
  height: number;
}
/** Measured card sizes by node ID; a Map, because node IDs such as "constructor" are legal. */
export type NodeSizes = ReadonlyMap<string, NodeSize>;

/** The height of a card before it is measured; its width comes from its exits (nodePorts). */
const defaultCardHeight = 105;

/** A card's size: as measured, else its exit-driven width and the default height. */
export function cardSize(node: RuleNode, sizes: NodeSizes): NodeSize {
  const measured = sizes.get(node.id);
  return {
    width: measured && measured.width > 0 ? measured.width : nodeWidth(node),
    height:
      measured && measured.height > 0 ? measured.height : defaultCardHeight,
  };
}

/** The point a viewport centres on to show the card whole. */
export function cardCenter(
  node: RuleNode,
  sizes: NodeSizes,
): { x: number; y: number } {
  const size = cardSize(node, sizes);
  return {
    x: node.position.x + size.width / 2,
    y: node.position.y + size.height / 2,
  };
}
