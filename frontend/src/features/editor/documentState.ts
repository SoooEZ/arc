import type { Definition, Diagnostic, Rule } from "../../types";
import { ruleSnapshot, type DefinitionChange } from "../../domain/graph";
import {
  sameDefinition,
  withNodePositions,
} from "../../domain/definitionEchoes";

export interface DocumentState {
  rule: Rule;
  baseline: string;
  source: string | null;
  sourceDirty: boolean;
  diagnostics: Diagnostic[];
}
export function initialDocument(rule: Rule): DocumentState {
  const opened = { ...rule, draft: withNodePositions(rule.draft) };
  return {
    rule: opened,
    baseline: ruleSnapshot(opened),
    source: null,
    sourceDirty: false,
    diagnostics: [],
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
  | { type: "source/diagnostics"; before: string; diagnostics: Diagnostic[] };

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
      return {
        ...state,
        rule: { ...state.rule, draft: withNodePositions(action.definition) },
      };
    case "rule/metadata":
      return { ...state, rule: { ...state.rule, ...action.patch } };
    case "rule/saved":
      return acknowledgeSave(state, action.submitted, action.rule);
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
        rule: { ...state.rule, draft: withNodePositions(action.definition) },
        source: action.source,
        sourceDirty: false,
        diagnostics: [],
      };
    case "source/diagnostics":
      return state.source === action.before
        ? { ...state, diagnostics: action.diagnostics }
        : state;
  }
}

/**
 * Advances the revision and saved baseline without discarding edits made after
 * submission. The server stores the submitted draft; its response differs only
 * in key order and explicit nulls. Keeping the local draft object keeps every
 * identity derived from it (diagnostics, variables, preview inputs and input
 * rows) unchanged. The server's trimmed name is adopted when nothing changed.
 */
function acknowledgeSave(
  state: DocumentState,
  submitted: Rule,
  response: Rule,
): DocumentState {
  const edited = ruleSnapshot(state.rule) !== ruleSnapshot(submitted);
  const localDraft = edited ? submitted.draft : state.rule.draft;
  // The server writes coordinates as 400.0; compared as numbers, the echo of an
  // unchanged draft is the local draft (see withNodePositions).
  const echoed = withNodePositions(response.draft);
  const saved: Rule = {
    ...response,
    draft: sameDefinition(localDraft, echoed) ? localDraft : echoed,
  };
  return {
    ...state,
    rule: edited
      ? {
          ...saved,
          name: state.rule.name,
          description: state.rule.description,
          draft: state.rule.draft,
        }
      : saved,
    baseline: ruleSnapshot(saved),
  };
}
