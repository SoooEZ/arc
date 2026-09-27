import InspectorSection from "./InspectorSection";
import OutputValueFields from "./OutputValueFields";
import type { NodeFieldsProps } from "./types";

export default function OutputFields(props: NodeFieldsProps) {
  return (
    <InspectorSection
      title="Output As"
      help="Choose the returned value from a variable, constant or expression. Add an optional output name to return an object with that field; leave it blank to return the value directly."
    >
      <OutputValueFields {...props} />
    </InspectorSection>
  );
}
