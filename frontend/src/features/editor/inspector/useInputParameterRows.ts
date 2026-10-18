import { useCallback } from "react";
import type { Definition, Input } from "../../../types";
import { newInputParameter, updateGraphInputs } from "../../../domain/graph";
import { canAddInput } from "../../../domain/limits";
import { useRowIdentities } from "./useRowIdentities";
import { useVariableRename } from "./useVariableRename";

/**
 * Row identity belongs to the editing session, never to the persisted input
 * schema. The callbacks take a row's identity and read the parameters from
 * the live draft, so they keep their own identity and a memoized card renders
 * for its own edits alone (lesson F39).
 */
export function useInputParameterRows(
  definition: Definition,
  onDefinitionChange: (
    update: (definition: Definition) => Definition,
    group?: string,
  ) => void,
) {
  const rows = useRowIdentities<Input>("input-row");
  const renameVariable = useVariableRename(definition, onDefinitionChange);
  const update = useCallback(
    (id: string, patch: Partial<Input>) => (definition: Definition) =>
      updateGraphInputs(definition, (current) =>
        current.map((input) =>
          rows.identity(input) === id
            ? rows.carry(input, { ...input, ...patch })
            : input,
        ),
      ),
    [rows],
  );
  const change = useCallback(
    (id: string, patch: Partial<Input>) =>
      onDefinitionChange(update(id, patch)),
    [onDefinitionChange, update],
  );
  /** A typed name also renames the variable in every expression that reads it. */
  const rename = useCallback(
    (id: string, name: string) =>
      renameVariable(
        `input-name:${id}`,
        (draft) => {
          const index = draft.inputs.findIndex(
            (input) => rows.identity(input) === id,
          );
          return index < 0
            ? null
            : { declaration: { input: index }, name: draft.inputs[index].name };
        },
        name,
        update(id, { name }),
      ),
    [renameVariable, rows, update],
  );
  const remove = useCallback(
    (id: string) =>
      onDefinitionChange((definition) =>
        updateGraphInputs(definition, (current) =>
          current.filter((input) => rows.identity(input) !== id),
        ),
      ),
    [onDefinitionChange, rows],
  );
  // The entry point checks the same limit the button shows; a full draft is left unchanged.
  const add = useCallback(
    () =>
      onDefinitionChange((definition) =>
        updateGraphInputs(definition, (current) =>
          canAddInput(definition)
            ? [...current, newInputParameter(definition)]
            : current,
        ),
      ),
    [onDefinitionChange],
  );
  return {
    rows: definition.inputs.map((input, index) => ({
      input,
      index,
      id: rows.identity(input),
    })),
    change,
    rename,
    remove,
    add,
  };
}
