import { lazy, useRef, type CSSProperties } from "react";
import { CircularProgress } from "@mui/material";
import type { VariableOption } from "../../domain/variables";
import { LazyBoundary } from "../../components/LazyBoundary";
import { useViewportEntry } from "../../hooks/useViewportEntry";
import AvailableVariables from "./AvailableVariables";
import ExpressionDialogButton from "./ExpressionDialogButton";

const InlineExpressionEditor = lazy(() => import("./InlineExpressionEditor"));

/** The help under an inline editor when its caller has none of its own. */
const defaultHelp = "ARC expression · Tab completes suggestions or indents.";

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
  const host = useRef<HTMLDivElement>(null);
  // Monaco mounts for the rows on screen and near it; a row further down the
  // inspector keeps a placeholder at the editor's height until it scrolls
  // there. A Switch's twenty or a Transform's fifty editors created in one
  // effect flush blocked the inspector and fanned every completion and
  // semantic-token request out to all of them.
  const shown = useViewportEntry(host);
  const help = helperText ?? defaultHelp;
  return (
    <div className="expression-input" ref={host}>
      <div className="expression-variables-toolbar">
        <AvailableVariables title={label} variables={variables} />
      </div>
      {shown ? (
        <LazyBoundary
          label={`${label.toLowerCase()} editor`}
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
            helperText={help}
          />
        </LazyBoundary>
      ) : (
        <EditorPlaceholder
          label={label}
          value={value}
          disabled={disabled}
          help={help}
        />
      )}
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

/** Monaco's height and padding, so the row keeps its place when the editor mounts. */
const placeholderStyle: CSSProperties = {
  height: 94,
  boxSizing: "border-box",
  padding: "6px 0",
  overflow: "hidden",
  whiteSpace: "pre",
  fontFamily: "var(--font-mono, monospace)",
  opacity: 0.6,
};

/**
 * The row's editor before it comes into view: the same fieldset and help line
 * at the editor's height, showing the expression as plain text. It carries no
 * accessible name, so the editor's textbox is the only control under the label.
 */
function EditorPlaceholder({
  label,
  value,
  disabled,
  help,
}: {
  label: string;
  value: string;
  disabled: boolean;
  help: string;
}) {
  return (
    <div className="inline-expression-field">
      <fieldset className="inline-expression-editor" data-readonly={disabled}>
        <legend>{label}</legend>
        <div
          className="inline-expression-placeholder"
          aria-hidden
          style={placeholderStyle}
        >
          {value}
        </div>
      </fieldset>
      <p className="inline-expression-help">{help}</p>
    </div>
  );
}
