import { useState } from "react";
import { MenuItem, TextField } from "@mui/material";
import type { InputType } from "../types";

export interface VariableOption {
  name: string;
  type: string;
  label: string;
}
type Mode = "variable" | "constant" | "expression" | "default";
// Use ARC's escapes; plain text is never treated as executable source.
export const quoteText = (text: string) =>
  '"' +
  text
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("\n", "\\n")
    .replaceAll("\r", "\\r")
    .replaceAll("\t", "\\t") +
  '"';
export function literalText(value: string): string | null {
  if (!/^("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')$/s.test(value)) return null;
  return value
    .slice(1, -1)
    .replace(
      /\\(.)/gs,
      (_, c: string) => ({ n: "\n", r: "\r", t: "\t" })[c] ?? c,
    );
}
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
  type: InputType;
  value?: string;
  variables: VariableOption[];
  disabled: boolean;
  onChange: (value: string | undefined) => void;
  optional?: boolean;
  helperText?: string;
}) {
  const [chosenMode, setChosenMode] = useState<Mode | null>(null);
  const literal = literalText(value ?? "");
  const isConstant =
    literal !== null ||
    /^(true|false|-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)$/i.test(value ?? "");
  const mode: Mode =
    chosenMode ??
    (!value
      ? "variable"
      : variables.some((v) => v.name === value)
        ? "variable"
        : isConstant
          ? "constant"
          : "expression");
  const choices = variables.filter(
    (v) => v.type === type || v.type === "RESULT",
  );
  const constant =
    type === "STRING" && literal !== null ? literal : (value ?? "");
  const chooseMode = (next: Mode) => {
    setChosenMode(next);
    if (next === "default") onChange(undefined);
    else if (next === "variable") {
      if (!choices.some((v) => v.name === value)) onChange(undefined);
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
      {mode === "variable" ? (
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
      ) : mode === "constant" && type === "BOOLEAN" ? (
        <TextField
          select
          label={label}
          value={value || "false"}
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
            mode === "expression" || type === "ARRAY" || type === "OBJECT"
          }
          minRows={mode === "expression" ? 2 : undefined}
          type={mode === "constant" && type === "NUMBER" ? "number" : "text"}
          onChange={(e) =>
            onChange(
              mode === "constant" && type === "STRING"
                ? quoteText(e.target.value)
                : e.target.value || undefined,
            )
          }
          helperText={
            mode === "constant" && type === "STRING"
              ? "Text value · no quotation marks needed"
              : mode === "expression"
                ? "ARC expression · quote literal text here"
                : helperText || type.toLowerCase()
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
