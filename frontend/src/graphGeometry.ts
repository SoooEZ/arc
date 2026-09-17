// Keep layout ports aligned with the handles displayed by GraphNode.
export const branchHandleX = { true: 0.27, false: 0.73 } as const;
export const defaultNodeSize = { width: 230, height: 105 };
export type NodeSizes = Record<string, { width: number; height: number }>;
