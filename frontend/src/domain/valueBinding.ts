import type { InputType } from "../types";
import { literalText } from "./expressions";

export type BindingMode = "variable" | "constant" | "expression" | "default";
export type ConstantType = "NUMBER" | "STRING" | "BOOLEAN" | "ARRAY" | "NULL";

export const constantDefaults: Record<ConstantType, string> = {
  NUMBER: "0",
  STRING: '""',
  BOOLEAN: "false",
  ARRAY: "[]",
  NULL: "null",
};

export function inferConstantType(value: string): ConstantType | null {
  const text = value.trim();
  if (literalText(text) !== null) return "STRING";
  if (/^(true|false)$/i.test(text)) return "BOOLEAN";
  if (/^null$/i.test(text)) return "NULL";
  if (/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) return "NUMBER";
  try {
    if (Array.isArray(JSON.parse(text))) return "ARRAY";
  } catch {
    // A nonliteral value stays available in expression mode.
  }
  return null;
}

export function isBindingConstant(value: string, type: InputType | "ANY") {
  if (type === "ANY" && inferConstantType(value) !== null) return true;
  if (literalText(value.trim()) !== null) return true;
  return /^(true|false|-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)$/i.test(value);
}

export function inferBindingMode(
  value: string | undefined,
  isConstant: boolean,
  variableNames: string[],
): BindingMode {
  if (!value) return "variable";
  if (variableNames.includes(value)) return "variable";
  if (!isConstant && /^[A-Za-z_][A-Za-z_0-9]*$/.test(value)) return "variable";
  return isConstant ? "constant" : "expression";
}
