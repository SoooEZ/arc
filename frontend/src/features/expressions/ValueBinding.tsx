import { useState } from "react";
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
export default function ValueBinding({
  label,
  type,
  value,
  variables,
  disabled,
  onChange,
  optional = true,
  helperText,
}: {
  label: string;
  type: BindingType;
  value?: string;
  variables: VariableOption[];
  disabled: boolean;
  onChange: (value: string | undefined) => void;
  optional?: boolean;
  helperText?: string;
}) {
  const [chosenMode, setChosenMode] = useState<BindingMode | null>(null);
  const [chosenType, setChosenType] = useState<ConstantType | null>(null);
  const dynamicType = type === "ANY" || type === "SCALAR";
  const constantTypes = bindingConstantTypes[type];
  const acceptedType = compatibleConstantType(value ?? "", type);
  const selectedType =
    chosenType && constantTypes.includes(chosenType) ? chosenType : null;
  const effectiveType = dynamicType
    ? (selectedType ?? acceptedType ?? "NUMBER")
    : type;
  const mode =
    chosenMode ??
    inferBindingMode(
      value,
      type,
      variables.map((variable) => variable.name),
    );
  const choices = variables.filter((v) => acceptsVariableType(type, v.type));
  const chooseMode = (next: BindingMode) => {
    if (next === "constant" && !constantTypes.length) return;
    setChosenMode(next);
    if (next === "default") onChange(undefined);
    else if (next === "variable") {
      if (!choices.some((v) => v.name === value)) onChange(undefined);
    } else if (next === "constant") {
      const nextType = acceptedType ?? selectedType ?? constantTypes[0];
      if (dynamicType) setChosenType(nextType);
      if (acceptedType === null) onChange(constantDefaults[nextType]);
    }
  };
  return (
    <div className="value-binding">
      <TextField
        select
        label={`${label} · value source`}
        value={mode}
        disabled={disabled}
        onChange={(e) => chooseMode(e.target.value as BindingMode)}
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
          value={effectiveType}
          disabled={disabled}
          onChange={(e) => {
            const next = e.target.value as ConstantType;
            setChosenType(next);
            onChange(constantDefaults[next]);
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
          type={effectiveType}
          value={value}
          disabled={disabled}
          helperText={helperText}
          onChange={onChange}
        />
      )}
      {mode === "variable" && (
        <TextField
          select
          label={label}
          value={value ?? ""}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value || undefined)}
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
          disabled={disabled}
          onChange={(expression) => {
            // Once editing begins, an empty buffer or a literal is still an
            // expression draft. Only the source dropdown changes editor mode.
            setChosenMode("expression");
            onChange(expression || undefined);
          }}
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
