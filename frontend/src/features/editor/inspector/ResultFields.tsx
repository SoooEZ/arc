import { useCallback } from "react";
import { patchGraphNode } from "../../../domain/graph";
import type { NodeFieldsProps } from "./types";
import InspectorSection from "./InspectorSection";
import IdentifierField from "./IdentifierField";
import { useVariableRename } from "./useVariableRename";

/**
 * The result variable of a kind that stores one (see domain/nodeKinds).
 * Renaming it also renames the variable in every expression that reads it.
 */
export default function ResultFields({
  rule,
  node,
  readOnly,
  onDefinitionChange,
}: NodeFieldsProps) {
  const renameVariable = useVariableRename(rule.draft, onDefinitionChange);
  const nodeId = node.id;
  const rename = useCallback(
    (output: string) =>
      renameVariable(
        `result-name:${nodeId}`,
        (draft) => {
          const declaring = draft.nodes.find((item) => item.id === nodeId);
          return declaring
            ? { declaration: { node: nodeId }, name: declaring.output ?? "" }
            : null;
        },
        output,
        (draft) => patchGraphNode(draft, nodeId, { output: output || null }),
      ),
    [renameVariable, nodeId],
  );
  return (
    <InspectorSection
      title="Save result as"
      help="Name this node’s result so connected downstream nodes can use it in variables and expressions. Renaming it updates the expressions that use it."
    >
      <IdentifierField
        label="Result variable"
        value={node.output || ""}
        onChange={rename}
        helperText="Later steps read the result by this name."
        disabled={readOnly}
      />
    </InspectorSection>
  );
}
