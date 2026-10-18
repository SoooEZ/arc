/**
 * A node of a published rule version that an execution failure points at.
 * Execution views hand it to their caller, which opens the referenced rule;
 * the editor's ReferenceTarget adds how to show it.
 */
export interface ReferenceLocation {
  ruleId: string;
  version: number;
  nodeId?: string;
}
