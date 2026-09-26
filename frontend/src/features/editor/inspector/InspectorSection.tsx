import { useId, type ReactNode } from "react";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  IconButton,
  Tooltip,
} from "@mui/material";
import { ChevronDown, Info } from "lucide-react";

interface HeadingProps {
  id: string;
  "aria-controls": string;
  title: string;
  help: string;
  count?: number;
  actions?: ReactNode;
}

// Keep the accordion button and its auxiliary controls as siblings. The
// summary still receives Accordion's context and names its content region.
function SectionHeading({
  id,
  "aria-controls": controls,
  title,
  help,
  count,
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
      <div className="inspector-section-actions">
        {actions}
        <Tooltip title={help}>
          <IconButton
            className="inspector-section-help"
            size="small"
            aria-label={`${title} help`}
          >
            <Info size={16} />
          </IconButton>
        </Tooltip>
      </div>
    </div>
  );
}

export default function InspectorSection({
  title,
  help,
  count,
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
        help={help}
        count={count}
        actions={actions}
      />
      <AccordionDetails>{children}</AccordionDetails>
    </Accordion>
  );
}
