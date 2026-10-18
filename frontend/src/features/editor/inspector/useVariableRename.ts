import { useCallback, useRef } from "react";
import type { Definition } from "../../../types";
import type { DefinitionChange } from "../../../domain/graph";
import {
  canRenameReferences,
  withRenamedReferences,
  type VariableDeclaration,
} from "../../../domain/variableRename";

/** A declaration in the current draft and the name it has there. */
export interface Declared {
  declaration: VariableDeclaration;
  name: string;
}

/** A name field's last edit: the name it set and the name the expressions read since. */
interface Carried {
  name: string;
  references: string;
}

/**
 * Renames a declared variable as its name field is typed and carries the
 * expressions that read it along (domain/variableRename). They follow the
 * last name they could be carried to, so a cleared, half-typed or clashing
 * name leaves them reading the earlier one until the name is complete and
 * unique again. A stored name the field did not set, after Undo, a code build
 * or a refused edit, starts afresh from that name.
 *
 * `field` names the name field, and its edits join one Undo step as typing
 * in one field does; `find` locates the declaration in a draft.
 */
export function useVariableRename(
  definition: Definition,
  onDefinitionChange: (change: DefinitionChange, group?: string) => void,
) {
  const latest = useRef(definition);
  latest.current = definition;
  const carried = useRef(new Map<string, Carried>());
  return useCallback(
    (
      field: string,
      find: (definition: Definition) => Declared | null,
      name: string,
      setName: DefinitionChange,
    ) => {
      const declared = find(latest.current);
      if (!declared) return;
      const last = carried.current.get(field);
      const from =
        last?.name === declared.name ? last.references : declared.name;
      const carry = canRenameReferences(
        latest.current,
        declared.declaration,
        from,
        name,
      );
      carried.current.set(field, { name, references: carry ? name : from });
      onDefinitionChange((current) => {
        const renamed = setName(current);
        return carry ? withRenamedReferences(renamed, from, name) : renamed;
      }, field);
    },
    [onDefinitionChange],
  );
}
