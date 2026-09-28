import { lazy } from "react";
import { CircularProgress } from "@mui/material";
import type { VariableOption } from "../../domain/graph";
import { LazyBoundary } from "../../components/LazyBoundary";
import AvailableVariables from "./AvailableVariables";
import ExpressionDialogButton from "./ExpressionDialogButton";

const InlineExpressionEditor = lazy(() => import("./InlineExpressionEditor"));

/** Graph expression inputs share the same catalog and language tools as Code studio. */
export default function ExpressionField({
  label = "Expression",
  value,
  onChange,
  variables,
  scopeKnown = true,
  disabled,
  helperText,
}: {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  variables: VariableOption[];
  /** False while the node's scope read is pending or failed (see NodeFieldsProps). */
  scopeKnown?: boolean;
  disabled: boolean;
  helperText?: string;
}) {
  return (
    <div className="expression-input">
      <div className="expression-variables-toolbar">
        <AvailableVariables title={label} variables={variables} />
      </div>
      <LazyBoundary
        label={`${label.toLowerCase()} editor`}
        fallback={
          <div className="inline-expression-loading" role="status">
            <CircularProgress size={16} /> Loading {label.toLowerCase()} editor…
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
      </LazyBoundary>
      <ExpressionDialogButton
        label={label}
        value={value}
        variables={variables}
        scopeKnown={scopeKnown}
        disabled={disabled}
        onChange={onChange}
      />
    </div>
  );
}
