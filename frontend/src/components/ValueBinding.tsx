import { useState } from "react";
import { MenuItem, TextField } from "@mui/material";
import type { InputType } from "../types";

import type { VariableOption } from "../domain/graph";
export type { VariableOption } from "../domain/graph";
import { literalText, quoteText } from "../domain/expressions";
export { literalText, quoteText } from "../domain/expressions";
type ConstantType = "NUMBER" | "STRING" | "BOOLEAN" | "ARRAY" | "NULL";
const constantDefaults: Record<ConstantType, string> = {
  NUMBER: "0",
  STRING: '""',
  BOOLEAN: "false",
  ARRAY: "[]",
  NULL: "null",
};
function constantType(value: string): ConstantType | null {
  const text = value.trim();
  if (literalText(text) !== null) return "STRING";
  if (/^(true|false)$/i.test(text)) return "BOOLEAN";
  if (/^null$/i.test(text)) return "NULL";
  if (/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) return "NUMBER";
  try {
    if (Array.isArray(JSON.parse(text))) return "ARRAY";
  } catch {
    /* Expressions remain editable as expressions. */
  }
  return null;
}
type Mode = "variable" | "constant" | "expression" | "default";
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
  type: InputType | "ANY";
  value?: string;
  variables: VariableOption[];
  disabled: boolean;
  onChange: (value: string | undefined) => void;
  optional?: boolean;
  helperText?: string;
}) {
  const [chosenMode, setChosenMode] = useState<Mode | null>(null);
  const [chosenType, setChosenType] = useState<ConstantType | null>(null);
  const inferredType = constantType(value ?? "");
  const effectiveType =
    type === "ANY" ? (chosenType ?? inferredType ?? "NUMBER") : type;
  const literal = literalText((value ?? "").trim());
  const isConstant =
    (type === "ANY" && inferredType !== null) ||
    literal !== null ||
    /^(true|false|-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)$/i.test(value ?? "");
  const mode: Mode =
    chosenMode ??
    (!value
      ? "variable"
      : variables.some((v) => v.name === value) ||
          (!isConstant && /^[A-Za-z_][A-Za-z_0-9]*$/.test(value))
        ? "variable"
        : isConstant
          ? "constant"
          : "expression");
  const choices = variables.filter(
    (v) => type === "ANY" || v.type === type || v.type === "RESULT",
  );
  const constant =
    effectiveType === "STRING" && literal !== null ? literal : (value ?? "");
  const chooseMode = (next: Mode) => {
    setChosenMode(next);
    if (next === "default") onChange(undefined);
    else if (next === "variable") {
      if (!choices.some((v) => v.name === value)) onChange(undefined);
    } else if (next === "constant" && type === "ANY") {
      const nextType = inferredType ?? chosenType ?? "NUMBER";
      setChosenType(nextType);
      if (inferredType === null) onChange(constantDefaults[nextType]);
    } else if (next === "constant" && !isConstant)
      onChange(
        type === "STRING"
          ? quoteText("")
          : type === "BOOLEAN"
            ? "false"
            : type === "NUMBER"
              ? "0"
              : "[]",
      );
  };
  return (
    <div className="value-binding">
      <TextField
        select
        label={`${label} · value source`}
        value={mode}
        disabled={disabled}
        onChange={(e) => chooseMode(e.target.value as Mode)}
      >
        <MenuItem value="variable">Upstream variable</MenuItem>
        {type !== "OBJECT" && <MenuItem value="constant">Constant</MenuItem>}
        <MenuItem value="expression">Expression</MenuItem>
        {optional && <MenuItem value="default">Use default / omit</MenuItem>}
      </TextField>
      {mode === "constant" && type === "ANY" && (
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
          {(["NUMBER", "STRING", "BOOLEAN", "ARRAY", "NULL"] as const).map(
            (t) => (
              <MenuItem key={t} value={t}>
                {t.toLowerCase()}
              </MenuItem>
            ),
          )}
        </TextField>
      )}
      {mode === "constant" && effectiveType === "NULL" ? (
        <TextField
          label={label}
          value="null"
          disabled
          helperText="Returns an explicit null value"
        />
      ) : mode === "variable" ? (
        <TextField
          select
          label={label}
          value={value ?? ""}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value || undefined)}
          helperText={helperText || "Inputs and results available at this node"}
        >
          <MenuItem value="">Select a variable</MenuItem>
          {!!value && !choices.some((v) => v.name === value) && (
            <MenuItem value={value} disabled>
              {value} · unavailable
            </MenuItem>
          )}
          {choices.map((v) => (
            <MenuItem key={v.name} value={v.name}>
              {v.name} · {v.label}
            </MenuItem>
          ))}
        </TextField>
      ) : mode === "constant" && effectiveType === "BOOLEAN" ? (
        <TextField
          select
          label={label}
          value={value?.trim().toLowerCase() || "false"}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          helperText={helperText}
        >
          <MenuItem value="true">true</MenuItem>
          <MenuItem value="false">false</MenuItem>
        </TextField>
      ) : mode !== "default" ? (
        <TextField
          label={label}
          value={mode === "constant" ? constant : (value ?? "")}
          disabled={disabled}
          multiline={
            mode === "expression" ||
            effectiveType === "ARRAY" ||
            effectiveType === "OBJECT"
          }
          minRows={mode === "expression" ? 2 : undefined}
          type={
            mode === "constant" && effectiveType === "NUMBER"
              ? "number"
              : "text"
          }
          onChange={(e) =>
            onChange(
              mode === "constant" && effectiveType === "STRING"
                ? quoteText(e.target.value)
                : e.target.value || undefined,
            )
          }
          helperText={
            mode === "constant" && effectiveType === "STRING"
              ? "Text value · no quotation marks needed"
              : mode === "expression"
                ? "ARC expression · quote literal text here"
                : helperText ||
                  (effectiveType === "ARRAY"
                    ? "ARC array literal, for example [1, 2, 3]"
                    : effectiveType.toLowerCase())
          }
        />
      ) : (
        <p className="muted-copy">
          {helperText ||
            "Uses the callee’s default or data source when available."}
        </p>
      )}
    </div>
  );
}
