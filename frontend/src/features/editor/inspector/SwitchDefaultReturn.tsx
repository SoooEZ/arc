import { Button } from "@mui/material";
import { Plus } from "lucide-react";
import {
  setSwitchDefaultReturn,
  switchDefaultOutput,
} from "../../../domain/switchBranches";
import ValueBinding from "../../expressions/ValueBinding";
import type { NodeFieldsProps } from "./types";
import InspectorSection from "./InspectorSection";

export default function SwitchDefaultReturn({
  rule,
  node,
  variables,
  readOnly,
  onDefinitionChange,
}: NodeFieldsProps) {
  const output = switchDefaultOutput(rule.draft, node.id);
  const destinations = rule.draft.edges
    .filter(
      (edge) => edge.source === node.id && edge.sourceHandle === "default",
    )
    .map(
      (edge) =>
        rule.draft.nodes.find((item) => item.id === edge.target)?.label ??
        edge.target,
    );
  return (
    <InspectorSection
      title="Default · no case matches"
      variables={variables}
      testId="switch-default-return"
    >
      <p className="muted-copy">Default runs when every case fails to match.</p>
      {output ? (
        <>
          <ValueBinding
            key={output.id}
            label="Default return value"
            type="ANY"
            value={output.expression ?? undefined}
            variables={variables}
            disabled={readOnly}
            optional={false}
            onChange={(value) =>
              onDefinitionChange((current) =>
                switchDefaultOutput(current, node.id)?.id === output.id
                  ? setSwitchDefaultReturn(
                      current,
                      node.id,
                      value ?? "",
                      output.id,
                      "",
                    )
                  : current,
              )
            }
          />
          <p className="muted-copy">
            Returns through the connected Output: {output.label}.
          </p>
        </>
      ) : destinations.length ? (
        <p className="muted-copy">
          Default continues to {destinations.join(", ")}. To set an independent
          return value here, connect Default to an Output that has no other
          incoming branches.
        </p>
      ) : (
        <>
          <p className="muted-copy">
            Connect Default to a next step, or add an Output and set its return
            value here.
          </p>
          <Button
            startIcon={<Plus size={14} />}
            disabled={
              readOnly ||
              rule.draft.nodes.length >= 100 ||
              rule.draft.edges.length >= 200
            }
            onClick={() => {
              const id = `default-${crypto.randomUUID().slice(0, 8)}`;
              onDefinitionChange((current) =>
                setSwitchDefaultReturn(
                  current,
                  node.id,
                  "0",
                  id,
                  `edge-${crypto.randomUUID().slice(0, 8)}`,
                ),
              );
            }}
          >
            Add default return
          </Button>
        </>
      )}
    </InspectorSection>
  );
}
