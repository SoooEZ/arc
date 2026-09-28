import { lazy, useState } from "react";
import { Button, CircularProgress } from "@mui/material";
import { ExternalLink } from "lucide-react";
import type { VariableOption } from "../../domain/variables";
import { LazyBoundary } from "../../components/LazyBoundary";

const ExpressionDialog = lazy(() => import("./ExpressionDialog"));

/** Opens the full expression editor for a value; the field or form around it shows the value. */
export default function ExpressionDialogButton({
  label,
  buttonLabel = "Open in Editor",
  value,
  variables,
  scopeKnown = true,
  disabled,
  onChange,
}: {
  label: string;
  buttonLabel?: string;
  value: string;
  variables: VariableOption[];
  /** False while the node's scope read is pending or failed (see NodeFieldsProps). */
  scopeKnown?: boolean;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        size="small"
        startIcon={<ExternalLink size={14} />}
        onClick={() => setOpen(true)}
        aria-label={`${buttonLabel} · ${label}`}
      >
        {buttonLabel}
      </Button>
      {open && (
        <LazyBoundary
          label="expression editor"
          fallback={<CircularProgress size={18} />}
          onDismiss={() => setOpen(false)}
        >
          <ExpressionDialog
            label={label}
            value={value}
            variables={variables}
            scopeKnown={scopeKnown}
            readOnly={disabled}
            onClose={() => setOpen(false)}
            onApply={(expression) => {
              onChange(expression);
              setOpen(false);
            }}
          />
        </LazyBoundary>
      )}
    </>
  );
}
