import type { Definition, Input } from "../../../types";
import { newInputParameter } from "../../../domain/graph";
import { useRowIdentities } from "./useRowIdentities";

/** Row identity belongs to the editing session, never to the persisted input schema. */
export function useInputParameterRows(
  inputs: Input[],
  onDefinitionChange: (update: (definition: Definition) => Definition) => void,
) {
  const { identity, carry } = useRowIdentities<Input>("input-row");
  const change = (index: number, patch: Partial<Input>) => {
    onDefinitionChange((definition) => ({
      ...definition,
      inputs: definition.inputs.map((input, currentIndex) =>
        index === currentIndex ? carry(input, { ...input, ...patch }) : input,
      ),
    }));
  };
  const remove = (index: number) => {
    onDefinitionChange((definition) => ({
      ...definition,
      inputs: definition.inputs.filter(
        (_, currentIndex) => currentIndex !== index,
      ),
    }));
  };
  const add = () => {
    onDefinitionChange((definition) => ({
      ...definition,
      inputs: [...definition.inputs, newInputParameter(definition)],
    }));
  };
  return {
    rows: inputs.map((input, index) => ({ input, index, id: identity(input) })),
    change,
    remove,
    add,
  };
}
