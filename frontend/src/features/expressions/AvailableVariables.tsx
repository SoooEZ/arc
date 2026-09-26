import { useId, useState } from "react";
import { Button, IconButton, Popover, Tooltip } from "@mui/material";
import { X } from "lucide-react";
import { variableOptionLabel, type VariableOption } from "../../domain/graph";

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
  const id = useId();
  const close = () => {
    setAnchor(null);
    setPreview(false);
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
        placement="bottom-end"
        describeChild
        slotProps={{ tooltip: { className: "expression-variable-tooltip" } }}
      >
        <Button
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
      <Popover
        id={id}
        open={!!anchor}
        anchorEl={anchor}
        onClose={close}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        slotProps={{
          paper: {
            className: "expression-variable-popover",
            role: "dialog",
            "aria-label": label,
          },
        }}
      >
        <div className="expression-variable-heading">
          <strong>Available variables</strong>
          <IconButton
            size="small"
            aria-label="Close available variables"
            onClick={close}
          >
            <X size={16} />
          </IconButton>
        </div>
        <VariableList variables={variables} />
      </Popover>
    </>
  );
}
