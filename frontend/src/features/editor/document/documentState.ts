import type { Definition, Diagnostic, Rule } from "../../../types";
import { ruleSnapshot, type DefinitionChange } from "../../../domain/graph";
import {
  editableDraft,
  sameDefinition,
} from "../../../domain/definitionEchoes";
import {
  noHistory,
  recordEdit,
  steppedBack,
  steppedForward,
  type DraftHistory,
} from "../../../domain/draftHistory";

export interface DocumentState {
  rule: Rule;
  baseline: string;
  source: string | null;
  sourceDirty: boolean;
  diagnostics: Diagnostic[];
  /** The drafts Undo and Redo step to; graph edits and code builds record them. */
  history: DraftHistory;
}
export function initialDocument(rule: Rule): DocumentState {
  const opened = { ...rule, draft: editableDraft(rule.draft) };
  return {
    rule: opened,
    baseline: ruleSnapshot(opened),
    source: null,
    sourceDirty: false,
    diagnostics: [],
    history: noHistory,
  };
}
export type DocumentAction =
  /**
   * `at` (ms) lets a quick repeat of the same edit join one Undo step;
   * `group` names that edit when the changed objects cannot (draftHistory).
   */
  | {
      type: "graph/change";
      change: DefinitionChange;
      at?: number;
      group?: string;
    }
  | { type: "graph/undo" }
  | { type: "graph/redo" }
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
        ...withDraft(state, draft),
        history: recordEdit(
          state.history,
          state.rule.draft,
          draft,
          action.at,
          action.group,
        ),
      };
    }
    // Unbuilt code is not part of the draft, so stepping would discard it.
    case "graph/undo": {
      const previous = state.history.past.at(-1);
      if (!previous || state.sourceDirty) return state;
      return {
        ...withDraft(state, previous),
        history: steppedBack(state.history, state.rule.draft),
      };
    }
    case "graph/redo": {
      const next = state.history.future.at(-1);
      if (!next || state.sourceDirty) return state;
      return {
        ...withDraft(state, next),
        history: steppedForward(state.history, state.rule.draft),
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
        rule: { ...state.rule, draft: editableDraft(action.definition) },
        history: noHistory,
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
    case "source/built": {
      if (state.source !== action.before) return state;
      const built = editableDraft(action.definition);
      return {
        ...state,
        rule: { ...state.rule, draft: built },
        source: action.source,
        sourceDirty: false,
        diagnostics: [],
        // Code that leaves the graph as it was is no step to undo.
        history: sameDefinition(state.rule.draft, built)
          ? state.history
          : recordEdit(state.history, state.rule.draft, built),
      };
    }
    case "source/diagnostics":
      return state.source === action.before
        ? { ...state, diagnostics: action.diagnostics }
        : state;
  }
}

/** The document showing `draft`: the code view renders it again. */
function withDraft(state: DocumentState, draft: Definition): DocumentState {
  return {
    ...state,
    rule: { ...state.rule, draft },
    source: null,
    sourceDirty: false,
    diagnostics: [],
  };
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
  // The server writes coordinates as 400.0 and an omitted pointer as null;
  // read as the editor reads them, the echo of an unchanged draft is the local
  // draft (see editableDraft).
  const echoed = editableDraft(response.draft);
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
