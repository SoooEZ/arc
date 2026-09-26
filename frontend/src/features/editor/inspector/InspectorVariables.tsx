import { useId, useState } from "react";
import { IconButton, Popover, Tooltip } from "@mui/material";
import { Braces, X } from "lucide-react";
import {
  variableOptionLabel,
  type VariableOption,
} from "../../../domain/graph";

function VariableList({ variables }: { variables: VariableOption[] }) {
  if (!variables.length)
    return (
      <p className="inspector-variable-empty">
        No upstream variables are available at this node.
      </p>
    );
  return (
    <ul className="variable-list inspector-variable-list">
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

export default function InspectorVariables({
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
              <p className="inspector-variable-hint">
                Click the icon to keep open.
              </p>
            </div>
          )
        }
        placement="left-start"
        describeChild
        slotProps={{ tooltip: { className: "inspector-variable-tooltip" } }}
      >
        <IconButton
          className="inspector-variables-button"
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
          <Braces size={16} />
        </IconButton>
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
            className: "inspector-variable-popover",
            role: "dialog",
            "aria-label": label,
          },
        }}
      >
        <div className="inspector-variable-heading">
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
