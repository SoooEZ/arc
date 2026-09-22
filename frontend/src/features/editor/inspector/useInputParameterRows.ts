import { useRef } from "react";
import type { Definition, Input } from "../../../types";

/** Row identity belongs to the editing session, never to the persisted input schema. */
export function useInputParameterRows(
  inputs: Input[],
  onDefinitionChange: (update: (definition: Definition) => Definition) => void,
) {
  const identities = useRef(new WeakMap<Input, string>());
  const sequence = useRef(0);
  const identity = (input: Input) => {
    let id = identities.current.get(input);
    if (!id) {
      id = `input-row-${++sequence.current}`;
      identities.current.set(input, id);
    }
    return id;
  };
  const change = (index: number, patch: Partial<Input>) => {
    onDefinitionChange((definition) => ({
      ...definition,
      inputs: definition.inputs.map((input, currentIndex) => {
        if (index !== currentIndex) return input;
        const changed = { ...input, ...patch };
        identities.current.set(changed, identity(input));
        return changed;
      }),
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
    onDefinitionChange((definition) => {
      let suffix = definition.inputs.length + 1;
      while (definition.inputs.some((input) => input.name === `input${suffix}`))
        suffix++;
      return {
        ...definition,
        inputs: [
          ...definition.inputs,
          {
            name: `input${suffix}`,
            type: "NUMBER",
            required: true,
            defaultValue: null,
          },
        ],
      };
    });
  };
  return {
    rows: inputs.map((input, index) => ({ input, index, id: identity(input) })),
    change,
    remove,
    add,
  };
}
