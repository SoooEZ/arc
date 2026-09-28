import { useRef } from "react";
import type { Definition } from "../../../types";
import { studioApi } from "../../../api/studio";
import { useAsyncResource } from "../../../hooks/useAsyncResource";
import {
  availableVariables,
  scopeGraphKey,
  type VariableOption,
} from "../../../domain/graph";
import { ownValue } from "../../../domain/records";

/** What the server reports in scope at a node, or nothing while that is unknown. */
export interface NodeScope {
  variables: VariableOption[];
  /**
   * False while the scope read is pending or failed: `variables` is then empty
   * (lesson F10), and no control may judge a variable unavailable, or drop
   * one, on its account.
   */
  known: boolean;
}

const noScopes: Record<string, string[]> = {};

/**
 * The variables the server reports in scope at `nodeId`. Node IDs are user
 * names such as "constructor", so the lookup ignores Object.prototype.
 */
export function nodeVariables(
  definition: Definition,
  nodeId: string,
  scopes: Record<string, string[]>,
): VariableOption[] {
  return availableVariables(definition, nodeId, ownValue(scopes, nodeId));
}

/** A pending or failed scope read offers no variables (lesson F10) and says so. */
export function useNodeVariables(
  definition: Definition,
  nodeId: string,
): NodeScope {
  const {
    data: scopes,
    loading,
    error,
  } = useAsyncResource(
    // Keyed by the structure scopes depend on: a label or expression edit
    // blanked the scope for 150 ms and read the whole draft again.
    scopeGraphKey(definition),
    (signal) => studioApi.variables(definition, { signal }),
    noScopes,
    { delay: 150 },
  );
  // The same options keep the previous array, so memoized rows see one prop.
  const previous = useRef<VariableOption[]>([]);
  const variables = nodeVariables(definition, nodeId, scopes);
  if (!sameOptions(previous.current, variables)) previous.current = variables;
  return { variables: previous.current, known: !loading && !error };
}

function sameOptions(left: VariableOption[], right: VariableOption[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index++) {
    const a = left[index];
    const b = right[index];
    if (a.name !== b.name || a.type !== b.type || a.label !== b.label)
      return false;
  }
  return true;
}
