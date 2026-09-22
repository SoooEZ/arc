import type { Definition, Diagnostic, Execution, Rule } from "../../types";
import { ruleSnapshot, type DefinitionChange } from "../../domain/graph";

export interface DocumentState {
  rule: Rule;
  baseline: string;
  source: string | null;
  sourceDirty: boolean;
  diagnostics: Diagnostic[];
  trace: Execution | null;
}
export function initialDocument(rule: Rule): DocumentState {
  return {
    rule,
    baseline: ruleSnapshot(rule),
    source: null,
    sourceDirty: false,
    diagnostics: [],
    trace: null,
  };
}
export type DocumentAction =
  | { type: "graph/change"; change: DefinitionChange }
  | { type: "graph/arranged"; before: Definition; definition: Definition }
  | { type: "version/loaded"; definition: Definition }
  | { type: "rule/metadata"; patch: Pick<Rule, "name" | "description"> }
  | { type: "rule/saved"; rule: Rule; submitted: Rule }
  | { type: "source/changed"; source: string }
  | { type: "source/rendered"; before: Definition; source: string }
  | {
      type: "source/built";
      before: string;
      definition: Definition;
      source: string;
    }
  | { type: "source/diagnostics"; before: string; diagnostics: Diagnostic[] }
  | { type: "execution/completed"; trace: Execution | null };

/** Draft/code transitions are atomic; layout and async renders cannot replace newer edits. */
export function documentReducer(
  state: DocumentState,
  action: DocumentAction,
): DocumentState {
  switch (action.type) {
    case "graph/change": {
      const draft = action.change(state.rule.draft);
      if (draft === state.rule.draft) return state;
      return {
        ...state,
        rule: { ...state.rule, draft },
        source: null,
        sourceDirty: false,
        diagnostics: [],
        trace: null,
      };
    }
    case "graph/arranged":
      return state.rule.draft === action.before
        ? documentReducer(state, {
            type: "graph/change",
            change: () => action.definition,
          })
        : state;
    case "version/loaded":
      return { ...state, rule: { ...state.rule, draft: action.definition } };
    case "rule/metadata":
      return { ...state, rule: { ...state.rule, ...action.patch } };
    case "rule/saved":
      return {
        ...state,
        rule:
          ruleSnapshot(state.rule) === ruleSnapshot(action.submitted)
            ? action.rule
            : {
                ...action.rule,
                name: state.rule.name,
                description: state.rule.description,
                draft: state.rule.draft,
              },
        baseline: ruleSnapshot(action.rule),
      };
    case "source/changed":
      return action.source === state.source
        ? state
        : {
            ...state,
            source: action.source,
            sourceDirty: true,
            diagnostics: [],
          };
    case "source/rendered":
      return state.source === null && state.rule.draft === action.before
        ? { ...state, source: action.source }
        : state;
    case "source/built":
      if (state.source !== action.before) return state;
      return {
        ...state,
        rule: { ...state.rule, draft: action.definition },
        source: action.source,
        sourceDirty: false,
        diagnostics: [],
        trace: null,
      };
    case "source/diagnostics":
      return state.source === action.before
        ? { ...state, diagnostics: action.diagnostics }
        : state;
    case "execution/completed":
      return { ...state, trace: action.trace };
  }
}
