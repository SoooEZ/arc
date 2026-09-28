import type { Definition } from "../../../types";
import { studioApi } from "../../../api/studio";
import { useAsyncResource } from "../../../hooks/useAsyncResource";
import {
  availableVariables,
  semanticGraphKey,
  type VariableOption,
} from "../../../domain/graph";
import { ownValue } from "../../../domain/records";

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

/** A pending or failed scope read offers no variables (lesson F10). */
export function useNodeVariables(
  definition: Definition,
  nodeId: string,
): VariableOption[] {
  const { data: scopes } = useAsyncResource(
    semanticGraphKey(definition),
    (signal) => studioApi.variables(definition, { signal }),
    noScopes,
    150,
  );
  return nodeVariables(definition, nodeId, scopes);
}
