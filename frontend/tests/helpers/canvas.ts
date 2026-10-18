import type { Locator, Page } from "@playwright/test";

// React Flow's DOM (`react-flow__node`, `react-flow__edge`, `data-id`) is a
// third-party contract: specs find canvas items through these locators, so a
// React Flow upgrade that renames it changes this file only.

/** A node's React Flow wrapper, which carries its position, selection and drag state. */
export function canvasNode(scope: Page | Locator, id: string): Locator {
  return scope.locator(`.react-flow__node[data-id="${id}"]`);
}

/** The node's ARC card inside the wrapper, which carries its kind, state and text. */
export function nodeCard(scope: Page | Locator, id: string): Locator {
  return canvasNode(scope, id).locator(".graph-node");
}

/** An edge's React Flow group, by edge ID. */
export function canvasEdge(scope: Page | Locator, id: string): Locator {
  return scope.locator(`.react-flow__edge[data-id="${id}"]`);
}
