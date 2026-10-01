import { Button } from "@mui/material";
import { Plus } from "lucide-react";
import {
  canAddSwitchDefaultReturn,
  addSwitchDefaultReturn,
  switchDefaultOutput,
} from "../../../domain/switchBranches";
import { patchGraphNode } from "../../../domain/graph";
import { shortId } from "../../../domain/ids";
import { handles } from "../../../domain/nodePorts";
import OutputValueFields from "./OutputValueFields";
import type { NodeFieldsProps } from "./types";
import InspectorSection from "./InspectorSection";

export default function SwitchDefaultReturn(props: NodeFieldsProps) {
  return (
    <InspectorSection
      title="Default · no case matches"
      help="Default runs when no case matches. Connect it to another node or configure a dedicated Output to return a fallback value."
      testId="switch-default-return"
    >
      <p className="muted-copy">Default runs when every case fails to match.</p>
      <DefaultRoute {...props} />
    </InspectorSection>
  );
}

/**
 * Where Default leads: an Output reached only through it is edited here; any
 * other connection is described; an unconnected Default can add an Output.
 */
function DefaultRoute({
  rule,
  node,
  variables,
  scopeKnown,
  readOnly,
  onDefinitionChange,
}: NodeFieldsProps) {
  const output = switchDefaultOutput(rule.draft, node.id);
  if (output)
    return (
      <>
        <OutputValueFields
          key={output.id}
          rule={rule}
          node={output}
          label="Default return value"
          variables={variables}
          scopeKnown={scopeKnown}
          readOnly={readOnly}
          patch={(patch) =>
            onDefinitionChange((current) =>
              switchDefaultOutput(current, node.id)?.id === output.id
                ? patchGraphNode(current, output.id, patch)
                : current,
            )
          }
        />
        <p className="muted-copy">
          Returns through the connected Output: {output.label}.
        </p>
      </>
    );
  const destinations = rule.draft.edges
    .filter(
      (edge) =>
        edge.source === node.id && edge.sourceHandle === handles.default,
    )
    .map(
      (edge) =>
        rule.draft.nodes.find((item) => item.id === edge.target)?.label ??
        edge.target,
    );
  if (destinations.length)
    return (
      <p className="muted-copy">
        Default continues to {destinations.join(", ")}. To set an independent
        return value here, connect Default to an Output that has no other
        incoming branches.
      </p>
    );
  return (
    <>
      <p className="muted-copy">
        Connect Default to a next step, or add an Output and set its return
        value here.
      </p>
      <Button
        startIcon={<Plus size={14} />}
        disabled={readOnly || !canAddSwitchDefaultReturn(rule.draft, node.id)}
        onClick={() => {
          // Document updaters can run more than once, so the IDs are chosen here.
          const outputId = shortId("default-");
          const edgeId = shortId("edge-");
          onDefinitionChange((current) =>
            addSwitchDefaultReturn(current, node.id, "0", outputId, edgeId),
          );
        }}
      >
        Add default return
      </Button>
    </>
  );
}
