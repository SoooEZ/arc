// Keep layout ports aligned with the handles displayed by GraphNode.
export { branchHandleX } from "../../../domain/nodePorts";
export const defaultNodeSize = { width: 230, height: 105 };
export interface NodeSize {
  width: number;
  height: number;
}
/** Measured card sizes by node ID; a Map, because node IDs such as "constructor" are legal. */
export type NodeSizes = ReadonlyMap<string, NodeSize>;
