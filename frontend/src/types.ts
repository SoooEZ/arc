export type Kind = "DECISION_TREE" | "FORMULA" | "RULE";
export type NodeType =
  "INPUT" | "FORMULA" | "CONDITION" | "REFERENCE" | "OUTPUT";
export type InputType = "NUMBER" | "STRING" | "BOOLEAN";
export interface Input {
  name: string;
  type: InputType;
  required: boolean;
  defaultValue: unknown;
}
export interface RuleNode {
  id: string;
  type: NodeType;
  label: string;
  position: { x: number; y: number };
  expression?: string | null;
  output?: string | null;
  ruleId?: string | null;
  version?: number | null;
  bindings?: Record<string, string> | null;
}
export interface RuleEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle: string;
}
export interface Definition {
  schemaVersion: number;
  inputs: Input[];
  nodes: RuleNode[];
  edges: RuleEdge[];
}
export interface Rule {
  id: string;
  name: string;
  description: string;
  kind: Kind;
  draft: Definition;
  revision: number;
  publishedVersion: number | null;
  createdAt: string;
  updatedAt: string;
}
export interface Version {
  ruleId: string;
  version: number;
  definition: Definition;
  publishedAt: string;
}
export interface Step {
  ruleId: string;
  version: number | null;
  nodeId: string;
  label: string;
  type: NodeType;
  value: unknown;
  branch: string | null;
  depth: number;
}
export interface Execution {
  ruleId: string;
  version: number | null;
  result: unknown;
  trace: Step[];
  durationMicros: number;
}
export const kindLabel: Record<Kind, string> = {
  DECISION_TREE: "Decision tree",
  FORMULA: "Formula",
  RULE: "Condition rule",
};
export const nodeLabel: Record<NodeType, string> = {
  INPUT: "Input",
  FORMULA: "Formula",
  CONDITION: "Condition",
  REFERENCE: "Reuse rule",
  OUTPUT: "Output",
};
