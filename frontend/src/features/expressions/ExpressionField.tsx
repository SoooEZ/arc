import { lazy, Suspense, useState } from "react";
import { Button, CircularProgress } from "@mui/material";
import { ExternalLink } from "lucide-react";
import type { VariableOption } from "../../domain/graph";
import AvailableVariables from "./AvailableVariables";

const ExpressionDialog = lazy(() => import("./ExpressionDialog"));
const InlineExpressionEditor = lazy(() => import("./InlineExpressionEditor"));

/** Graph expression inputs share the same catalog and language tools as Code studio. */
export default function ExpressionField({
  label = "Expression",
  value,
  onChange,
  variables,
  disabled,
  helperText,
  hideInput = false,
  buttonLabel = "Open in Editor",
}: {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  variables: VariableOption[];
  disabled: boolean;
  helperText?: string;
  hideInput?: boolean;
  buttonLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="expression-input">
      {!hideInput && (
        <div className="expression-variables-toolbar">
          <AvailableVariables title={label} variables={variables} />
        </div>
      )}
      {!hideInput && (
        <Suspense
          fallback={
            <div className="inline-expression-loading" role="status">
              <CircularProgress size={16} /> Loading {label.toLowerCase()}{" "}
              editor…
            </div>
          }
        >
          <InlineExpressionEditor
            label={label}
            value={value}
            variables={variables}
            readOnly={disabled}
            onChange={onChange}
            helperText={helperText}
          />
        </Suspense>
      )}
      <Button
        size="small"
        startIcon={<ExternalLink size={14} />}
        onClick={() => setOpen(true)}
        aria-label={`${buttonLabel} · ${label}`}
      >
        {buttonLabel}
      </Button>
      {open && (
        <Suspense fallback={<CircularProgress size={18} />}>
          <ExpressionDialog
            label={label}
            value={value}
            variables={variables}
            readOnly={disabled}
            onClose={() => setOpen(false)}
            onApply={(expression) => {
              onChange(expression);
              setOpen(false);
            }}
          />
        </Suspense>
      )}
    </div>
  );
}
