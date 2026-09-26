import { useEffect, useId, useState } from "react";
import { IconButton, Popover, Tooltip } from "@mui/material";
import { CircleAlert, X } from "lucide-react";

export default function InspectorProblems({ errors }: { errors: string[] }) {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const id = useId();
  useEffect(() => {
    if (!errors.length) setAnchor(null);
  }, [errors.length]);
  const messages = (
    <ul className="inspector-error-list">
      {errors.map((error, index) => (
        <li key={index}>{error}</li>
      ))}
    </ul>
  );
  return (
    <span className="inspector-error-slot">
      {!!errors.length && (
        <>
          <Tooltip
            title={anchor ? "" : messages}
            placement="left"
            describeChild
          >
            <IconButton
              size="small"
              color="error"
              aria-label={`Node errors (${errors.length})`}
              aria-haspopup="dialog"
              aria-expanded={!!anchor}
              aria-controls={anchor ? id : undefined}
              onClick={(event) => setAnchor(event.currentTarget)}
            >
              <CircleAlert size={17} />
            </IconButton>
          </Tooltip>
          <Popover
            id={id}
            open={!!anchor}
            anchorEl={anchor}
            onClose={() => setAnchor(null)}
            anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
            transformOrigin={{ vertical: "top", horizontal: "right" }}
            slotProps={{
              paper: {
                className: "inspector-error-popover",
                role: "dialog",
                "aria-label": "Node errors",
              },
            }}
          >
            <div className="inspector-error-heading">
              <strong>Node errors ({errors.length})</strong>
              <IconButton
                size="small"
                aria-label="Close node errors"
                onClick={() => setAnchor(null)}
              >
                <X size={16} />
              </IconButton>
            </div>
            {messages}
          </Popover>
        </>
      )}
    </span>
  );
}
