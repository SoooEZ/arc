import { MenuItem, TextField } from "@mui/material";

import { variableOptionLabel, type VariableOption } from "../../domain/graph";
import {
  acceptsVariableType,
  bindingConstantTypes,
  compatibleConstantType,
  constantDefaults,
  inferBindingMode,
  type BindingMode,
  type BindingType,
  type ConstantType,
} from "../../domain/valueBinding";
import ExpressionField from "./ExpressionField";
import ConstantValueField from "./ConstantValueField";
import { useEditingPin } from "./useEditingPin";

const bindingModes: readonly BindingMode[] = [
  "variable",
  "constant",
  "expression",
  "default",
];

/** The value source, and for ANY/SCALAR bindings the constant type, being edited. */
interface BindingEditor {
  mode: BindingMode;
  constantType: ConstantType | null;
}

export default function ValueBinding({
  label,
  type,
  value,
  variables,
  scopeKnown = true,
  disabled,
  onChange,
  optional = true,
  helperText,
}: {
  label: string;
  type: BindingType;
  value?: string;
  variables: VariableOption[];
  /** False while the node's scope read is pending or failed (see NodeFieldsProps). */
  scopeKnown?: boolean;
  disabled: boolean;
  onChange: (value: string | undefined) => void;
  optional?: boolean;
  helperText?: string;
}) {
  const [editing, keepEditor] = useEditingPin<BindingEditor>(value);
  const dynamicType = type === "ANY" || type === "SCALAR";
  const constantTypes = bindingConstantTypes[type];
  const acceptedType = compatibleConstantType(value ?? "", type);
  const pinnedType =
    editing?.constantType && constantTypes.includes(editing.constantType)
      ? editing.constantType
      : null;
  // Only ANY and SCALAR offer several types; OBJECT offers no constant at all.
  const constantType: ConstantType =
    pinnedType ?? acceptedType ?? constantTypes[0] ?? "NUMBER";
  const mode =
    editing?.mode ??
    inferBindingMode(
      value,
      type,
      variables.map((variable) => variable.name),
    );
  const choices = variables.filter((v) => acceptsVariableType(type, v.type));
  // Typing keeps the current editor, even while the value is empty or partial.
  const edit = (next: string | undefined) => {
    keepEditor({ mode, constantType }, next);
    onChange(next);
  };
  const chooseMode = (next: BindingMode) => {
    if (next === "constant" && !constantTypes.length) return;
    if (next === "default") {
      keepEditor({ mode: next, constantType: null }, undefined);
      onChange(undefined);
    } else if (next === "variable") {
      // While the scope is unknown the value stays: the picker shows it as unavailable
      // until the read answers, instead of erasing an expression the editor cannot undo.
      const kept =
        !scopeKnown || choices.some((v) => v.name === value)
          ? value
          : undefined;
      keepEditor({ mode: next, constantType: null }, kept);
      if (kept === undefined) onChange(undefined);
    } else if (next === "constant") {
      // A compatible literal is kept; anything else starts from the type's default.
      const nextType = acceptedType ?? pinnedType ?? constantTypes[0];
      const nextValue = acceptedType ? value : constantDefaults[nextType];
      keepEditor({ mode: next, constantType: nextType }, nextValue);
      if (!acceptedType) onChange(nextValue);
    } else keepEditor({ mode: next, constantType: null }, value);
  };
  const chooseConstantType = (next: ConstantType) => {
    keepEditor(
      { mode: "constant", constantType: next },
      constantDefaults[next],
    );
    onChange(constantDefaults[next]);
  };
  return (
    <div className="value-binding">
      <TextField
        select
        label={`${label} · value source`}
        value={mode}
        disabled={disabled}
        onChange={(e) => {
          const next = bindingModes.find((item) => item === e.target.value);
          if (next) chooseMode(next);
        }}
      >
        <MenuItem value="variable">Upstream variable</MenuItem>
        {!!constantTypes.length && (
          <MenuItem value="constant">Constant</MenuItem>
        )}
        <MenuItem value="expression">Expression</MenuItem>
        {optional && <MenuItem value="default">Use default / omit</MenuItem>}
      </TextField>
      {mode === "constant" && dynamicType && (
        <TextField
          select
          label="Constant type"
          value={constantType}
          disabled={disabled}
          onChange={(e) => {
            const next = constantTypes.find((item) => item === e.target.value);
            if (next) chooseConstantType(next);
          }}
        >
          {constantTypes.map((t) => (
            <MenuItem key={t} value={t}>
              {t.toLowerCase()}
            </MenuItem>
          ))}
        </TextField>
      )}
      {mode === "constant" && (
        <ConstantValueField
          label={label}
          type={constantType}
          value={value}
          disabled={disabled}
          helperText={helperText}
          onChange={edit}
        />
      )}
      {mode === "variable" && (
        <TextField
          select
          label={label}
          value={value ?? ""}
          disabled={disabled}
          onChange={(e) => edit(e.target.value || undefined)}
          helperText={
            helperText ||
            (choices.length
              ? "Inputs and results available at this node"
              : "No compatible upstream variables are available at this node.")
          }
        >
          <MenuItem value="">Select a variable</MenuItem>
          {!!value && !choices.some((v) => v.name === value) && (
            <MenuItem value={value} disabled>
              {value} · unavailable
            </MenuItem>
          )}
          {choices.map((v) => (
            <MenuItem
              key={v.name}
              value={v.name}
              aria-label={variableOptionLabel(v)}
            >
              <span
                className="value-binding-variable"
                title={variableOptionLabel(v)}
              >
                <strong>{v.name}</strong> [{v.type.toLowerCase()}]{" "}
                <em className="value-binding-variable-from">from</em>{" "}
                <strong>{v.label}</strong>
              </span>
            </MenuItem>
          ))}
        </TextField>
      )}
      {mode === "expression" && (
        <ExpressionField
          label={label}
          value={value ?? ""}
          variables={variables}
          scopeKnown={scopeKnown}
          disabled={disabled}
          onChange={(expression) => edit(expression || undefined)}
          helperText="ARC expression · quote literal text here"
        />
      )}
      {mode === "default" && (
        <p className="muted-copy">
          {helperText ||
            "Uses the callee’s default or data source when available."}
        </p>
      )}
    </div>
  );
}
