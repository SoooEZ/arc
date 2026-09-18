import { lazy, Suspense, useState } from "react";
import { Button, CircularProgress, TextField } from "@mui/material";
import { Braces } from "lucide-react";
import type { VariableOption } from "../domain/graph";

const ExpressionDialog = lazy(() => import("./ExpressionDialog"));

/** Graph expression inputs share the same catalog and language tools as Code studio. */
export default function ExpressionField({
  label = "Expression",
  value,
  onChange,
  variables,
  disabled,
  helperText,
  hideInput = false,
  buttonLabel = "Functions & editor",
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
        <TextField
          className="expression-field"
          label={label}
          value={value}
          multiline
          minRows={3}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          helperText={helperText}
        />
      )}
      <Button
        size="small"
        startIcon={<Braces size={14} />}
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
