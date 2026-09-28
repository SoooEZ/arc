import { useId, useLayoutEffect, useRef, useState } from "react";
import { Button, IconButton, Paper, Popper, Tooltip } from "@mui/material";
import { X } from "lucide-react";
import {
  variableOptionLabel,
  type VariableOption,
} from "../../domain/variables";

function VariableList({ variables }: { variables: VariableOption[] }) {
  if (!variables.length)
    return (
      <p className="expression-variable-empty">
        No upstream variables are available at this node.
      </p>
    );
  return (
    <ul className="variable-list expression-variable-list">
      {variables.map((variable) => (
        <Tooltip key={variable.name} title={variableOptionLabel(variable)}>
          <li>
            <div>
              <code data-kind={variable.type === "RESULT" ? "result" : "input"}>
                {variable.name}
              </code>
              <span>{variable.type.toLowerCase()}</span>
            </div>
            <small>{variable.label}</small>
          </li>
        </Tooltip>
      ))}
    </ul>
  );
}

export default function AvailableVariables({
  title,
  variables,
}: {
  title: string;
  variables: VariableOption[];
}) {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [preview, setPreview] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const [availableHeight, setAvailableHeight] = useState(0);
  const id = useId();
  const visible = preview || !!anchor;
  useLayoutEffect(() => {
    if (!visible) return;
    const measure = () => {
      const top = trigger.current?.getBoundingClientRect().top ?? 0;
      setAvailableHeight(Math.max(0, Math.floor(top - 20)));
    };
    measure();
    window.addEventListener("resize", measure);
    document.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      document.removeEventListener("scroll", measure, true);
    };
  }, [visible]);
  const close = () => {
    setAnchor(null);
    setPreview(false);
    trigger.current?.focus();
  };
  const label = `Available variables · ${title}`;
  return (
    <>
      <Tooltip
        open={preview && !anchor}
        onOpen={() => {
          if (!anchor) setPreview(true);
        }}
        onClose={() => setPreview(false)}
        disableFocusListener
        title={
          anchor ? (
            ""
          ) : (
            <div>
              <strong>Available variables</strong>
              <VariableList variables={variables} />
              <p className="expression-variable-hint">
                Click to keep this list open.
              </p>
            </div>
          )
        }
        placement="top-end"
        describeChild
        slotProps={{
          tooltip: {
            className: "expression-variable-tooltip",
            style: { maxHeight: availableHeight },
          },
          popper: {
            popperOptions: { strategy: "fixed" },
            modifiers: [{ name: "flip", enabled: false }],
          },
        }}
      >
        <Button
          ref={trigger}
          className="expression-variables-button"
          size="small"
          aria-label={label}
          aria-haspopup="dialog"
          aria-expanded={!!anchor}
          aria-controls={anchor ? id : undefined}
          onClick={(event) => {
            setPreview(false);
            setAnchor(event.currentTarget);
          }}
        >
          Available variables
        </Button>
      </Tooltip>
      <Popper
        className="expression-variable-popper"
        role="presentation"
        open={!!anchor}
        anchorEl={anchor}
        placement="top-end"
        popperOptions={{ strategy: "fixed" }}
        modifiers={[
          { name: "offset", options: { offset: [0, 8] } },
          { name: "flip", enabled: false },
          { name: "preventOverflow", options: { padding: 8 } },
        ]}
        // Keep the nonmodal panel within an enclosing dialog's focus boundary.
        container={anchor?.closest('[role="dialog"]') ?? undefined}
      >
        <Paper
          id={id}
          className="expression-variable-popover"
          role="dialog"
          aria-label={label}
          aria-modal={false}
          style={{ maxHeight: availableHeight }}
          onKeyDown={(event) => {
            if (event.key === "Escape") event.stopPropagation();
          }}
        >
          <div className="expression-variable-heading">
            <strong>Available variables</strong>
            <IconButton
              autoFocus
              size="small"
              aria-label="Close available variables"
              onClick={close}
            >
              <X size={16} />
            </IconButton>
          </div>
          <VariableList variables={variables} />
        </Paper>
      </Popper>
    </>
  );
}
