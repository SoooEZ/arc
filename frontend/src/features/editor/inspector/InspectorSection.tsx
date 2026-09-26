import { useId, type ReactNode } from "react";
import { Accordion, AccordionDetails, AccordionSummary } from "@mui/material";
import { ChevronDown } from "lucide-react";
import type { VariableOption } from "../../../domain/graph";
import InspectorVariables from "./InspectorVariables";

interface HeadingProps {
  id: string;
  "aria-controls": string;
  title: string;
  count?: number;
  variables?: VariableOption[];
  actions?: ReactNode;
}

// Keep the accordion button and its auxiliary controls as siblings. The
// summary still receives Accordion's context and names its content region.
function SectionHeading({
  id,
  "aria-controls": controls,
  title,
  count,
  variables,
  actions,
}: HeadingProps) {
  return (
    <div className="inspector-section-heading">
      <AccordionSummary
        id={id}
        aria-controls={controls}
        expandIcon={<ChevronDown size={15} />}
      >
        <h4>{title}</h4>
        {count !== undefined && (
          <span className="inspector-section-count">{count}</span>
        )}
      </AccordionSummary>
      {(actions || variables) && (
        <div className="inspector-section-actions">
          {actions}
          {variables && (
            <InspectorVariables title={title} variables={variables} />
          )}
        </div>
      )}
    </div>
  );
}

export default function InspectorSection({
  title,
  count,
  variables,
  actions,
  children,
  testId,
}: Omit<HeadingProps, "id" | "aria-controls"> & {
  children: ReactNode;
  testId?: string;
}) {
  const id = useId();
  return (
    <Accordion
      className="inspector-section inspector-accordion"
      defaultExpanded
      disableGutters
      elevation={0}
      square
      slots={{ heading: "div" }}
      slotProps={{
        region: {
          "aria-labelledby": undefined,
          "aria-label": `${title} section`,
        },
      }}
      data-testid={testId}
    >
      <SectionHeading
        id={`${id}-heading`}
        aria-controls={`${id}-content`}
        title={title}
        count={count}
        variables={variables}
        actions={actions}
      />
      <AccordionDetails>{children}</AccordionDetails>
    </Accordion>
  );
}
