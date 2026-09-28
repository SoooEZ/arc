import type { Definition } from "../../../types";
import { studioApi } from "../../../api/studio";
import { useAsyncResource } from "../../../hooks/useAsyncResource";
import {
  availableVariables,
  semanticGraphKey,
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
    semanticGraphKey(definition),
    (signal) => studioApi.variables(definition, { signal }),
    noScopes,
    150,
  );
  return {
    variables: nodeVariables(definition, nodeId, scopes),
    known: !loading && !error,
  };
}
