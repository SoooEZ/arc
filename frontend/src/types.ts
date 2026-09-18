export type Kind = "DECISION_TREE" | "FORMULA" | "RULE";
export type NodeType =
  | "INPUT"
  | "FORMULA"
  | "CONDITION"
  | "SWITCH"
  | "TRANSFORM"
  | "REFERENCE"
  | "OUTPUT";
export type InputType = "NUMBER" | "STRING" | "BOOLEAN" | "ARRAY" | "OBJECT";
export interface Input {
  name: string;
  type: InputType;
  required: boolean;
  defaultValue: unknown;
  source?: SourceBinding | null;
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
  cases?: BranchCase[] | null;
  fields?: TransformField[] | null;
}
export interface BranchCase {
  id: string;
  label: string;
  expression: string;
}
export interface TransformField {
  name: string;
  expression: string;
}
export interface RuleEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle: string;
}
export interface Definition {
  schemaVersion: number;
  notes?: string[] | null;
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
  sources?: {
    input: string;
    sourceId: string;
    version: number;
    status: string;
    durationMicros: number;
  }[];
}
export const kindLabel: Record<Kind, string> = {
  DECISION_TREE: "Decision tree",
  FORMULA: "Formula",
  RULE: "Condition rule",
};
export const kindDescription: Record<Kind, string> = {
  FORMULA: "Calculate a value, such as a price or a score.",
  RULE: "Evaluate a condition, such as whether an order is eligible.",
  DECISION_TREE: "Combine conditions and calculations across branching paths.",
};
export const nodeLabel: Record<NodeType, string> = {
  INPUT: "Input",
  FORMULA: "Formula",
  CONDITION: "Condition",
  SWITCH: "Switch",
  TRANSFORM: "Transform",
  REFERENCE: "Reuse rule",
  OUTPUT: "Output",
};

export interface SourceBinding {
  id: string;
  version: number;
  bindings: Record<string, string>;
  pointer: string;
  onError: "FAIL" | "DEFAULT";
}
export interface SourceConfig {
  kind: "HTTP" | "LOOKUP";
  url?: string;
  parameters: Input[];
  entries?: Record<string, unknown>;
  secretHeaders?: Record<string, string>;
  timeoutMs: number;
}
export interface DataSource {
  id: string;
  name: string;
  version: number;
  definition: SourceConfig;
}
export interface FunctionEntry {
  name: string;
  category: string;
  signature: string;
  description: string;
  snippet: string;
  supported: boolean;
  origin: string;
}
export interface Diagnostic {
  message: string;
  line: number;
  column: number;
}
export interface Build {
  definition: Definition | null;
  source: string;
  diagnostics: Diagnostic[];
}
