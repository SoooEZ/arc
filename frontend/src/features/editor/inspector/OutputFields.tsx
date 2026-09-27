import InspectorSection from "./InspectorSection";
import OutputValueFields from "./OutputValueFields";
import type { NodeFieldsProps } from "./types";

export default function OutputFields(props: NodeFieldsProps) {
  return (
    <InspectorSection
      title="Output As"
      help="Choose a variable, constant or expression. One Output returns its value, wrapped in a field if named. Multiple Outputs return one object using each output name, otherwise a plain variable name or the node ID. Each reached Output must have a unique field name."
    >
      <OutputValueFields {...props} />
    </InspectorSection>
  );
}
