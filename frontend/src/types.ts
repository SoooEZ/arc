export type Kind = "DECISION_TREE" | "FORMULA" | "RULE";
export type NodeType =
  | "INPUT"
  | "FORMULA"
  | "CONDITION"
  | "SWITCH"
  | "TRANSFORM"
  | "REFERENCE"
  | "OUTPUT"
  | "DECISION_TABLE";
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
  selector?: string | null;
  output?: string | null;
  outputName?: string | null;
  ruleId?: string | null;
  version?: number | null;
  bindings?: Record<string, string> | null;
  cases?: BranchCase[] | null;
  fields?: TransformField[] | null;
  table?: DecisionTable | null;
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
/**
 * Which rows of a decision table give its value: the first that matches, the
 * only one that may match (several fail the run), or every match as a list.
 * Null and absent read as FIRST.
 */
export type HitPolicy = "FIRST" | "UNIQUE" | "COLLECT";
/** A condition column: an expression evaluated once, named by its label. */
export interface DecisionTableCondition {
  label: string;
  expression: string;
}
/** A result column: its name keys the value when a table has several. */
export interface DecisionTableResult {
  name: string;
}
/**
 * One row: a test per condition column (`-` matches any value) and an
 * expression per result column.
 */
export interface DecisionTableRow {
  when: string[];
  then: string[];
}
export interface DecisionTable {
  hitPolicy?: HitPolicy | null;
  conditions: DecisionTableCondition[];
  results: DecisionTableResult[];
  rows: DecisionTableRow[];
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
export interface Page<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
}
export interface RuleSummary extends Omit<Rule, "draft"> {
  nodeCount: number;
  inputCount: number;
  referenceCount: number;
  /** The draft differs from the latest published version; false when never published. */
  draftChanged: boolean;
}
export interface VersionSummary {
  ruleId: string;
  version: number;
  publishedAt: string;
  /** What its publisher wrote about the version, or null. */
  note: string | null;
}
export interface SourceSummary {
  id: string;
  name: string;
  version: number;
  kind: SourceConfig["kind"];
}
export interface SourceVersionSummary {
  id: string;
  version: number;
  createdAt: string;
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
  /** A decision table's matched rows, numbered from 1; absent for other steps. */
  matchedRows?: number[] | null;
}
export interface Execution {
  ruleId: string;
  version: number | null;
  result: unknown;
  trace: Step[];
  durationMicros: number;
  traceEnabled?: boolean;
  traceTruncated?: boolean;
  executedSteps?: number;
  traceBytes?: number;
  timing?: {
    preparationMicros: number;
    executionMicros: number;
    totalMicros: number;
  };
  sources?: {
    input: string;
    sourceId: string;
    version: number;
    status: string;
    durationMicros: number;
  }[];
}
export interface ExecutionOptions {
  trace?: boolean;
  timeoutMs?: number;
}

/**
 * A saved test of a rule: inputs and what they must produce. With
 * `expectedError` set, the run must fail with a message containing it;
 * otherwise it must return `expectedResult` (null expects null).
 */
export interface TestCase {
  id: number;
  ruleId: string;
  name: string;
  inputs: Record<string, unknown>;
  expectedResult: unknown;
  expectedError: string | null;
  createdAt: string;
  updatedAt: string;
}
export type TestCaseWrite = Pick<
  TestCase,
  "name" | "inputs" | "expectedResult" | "expectedError"
>;

/**
 * Another rule that calls this one, from `GET /rules/{id}/callers`: which
 * versions of this rule its saved draft and its latest published version pin.
 */
export interface RuleCaller {
  ruleId: string;
  name: string;
  /** The versions the caller's saved draft pins; null when the draft does not call the rule. */
  draftPins: number[] | null;
  /** The caller's latest published version, when it calls the rule, and the versions it pins. */
  published: { version: number; pins: number[] } | null;
  /** How many earlier published versions of the caller call the rule. */
  earlierVersions: number;
}

/**
 * `POST /rules/{id}/duplicate`: a new rule with the saved draft, or published
 * `version`, of another. An omitted description copies the original's, and
 * its saved tests are copied unless `includeTests` is false.
 */
export interface RuleDuplicate {
  id: string;
  name: string;
  description?: string | null;
  version?: number | null;
  includeTests?: boolean;
}

export interface SourceBinding {
  id: string;
  version: number;
  bindings: Record<string, string>;
  /**
   * The JSON pointer into the source's result; "" reads the whole result. An
   * API draft or a `source` statement may omit it, and the server stores and
   * echoes it as null: the editor reads such a binding as "" (`editableDraft`).
   */
  pointer: string | null;
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
