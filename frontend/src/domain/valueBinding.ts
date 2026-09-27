import type { InputType } from "../types";
import { literalText } from "./expressions";

export type BindingMode = "variable" | "constant" | "expression" | "default";
export type ConstantType = "NUMBER" | "STRING" | "BOOLEAN" | "ARRAY" | "NULL";
export type BindingType = InputType | "ANY" | "SCALAR";

export const bindingConstantTypes: Readonly<
  Record<BindingType, readonly ConstantType[]>
> = {
  NUMBER: ["NUMBER"],
  STRING: ["STRING"],
  BOOLEAN: ["BOOLEAN"],
  ARRAY: ["ARRAY"],
  OBJECT: [],
  ANY: ["NUMBER", "STRING", "BOOLEAN", "ARRAY", "NULL"],
  SCALAR: ["NUMBER", "STRING", "BOOLEAN"],
};

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

export function compatibleConstantType(
  value: string,
  type: BindingType,
): ConstantType | null {
  const inferred = inferConstantType(value);
  return inferred && bindingConstantTypes[type].includes(inferred)
    ? inferred
    : null;
}

/** Computed results and property paths have no declared type; keep their actual literal type. */
export function comparisonBindingType(
  value: string,
  declaredType?: InputType,
): BindingType {
  if (declaredType) return declaredType;
  const inferred = inferConstantType(value);
  return inferred && inferred !== "NULL" ? inferred : "ANY";
}

/** Result types are determined at execution time; keep those variables selectable. */
export function acceptsVariableType(
  binding: BindingType,
  variable: InputType | "RESULT",
): boolean {
  return (
    binding === "ANY" ||
    variable === "RESULT" ||
    binding === variable ||
    (binding === "SCALAR" &&
      bindingConstantTypes.SCALAR.some((type) => type === variable))
  );
}

export function inferBindingMode(
  value: string | undefined,
  type: BindingType,
  variableNames: string[],
): BindingMode {
  if (!value) return "variable";
  const inferred = inferConstantType(value);
  if (inferred)
    return bindingConstantTypes[type].includes(inferred)
      ? "constant"
      : "expression";
  if (variableNames.includes(value)) return "variable";
  if (/^[A-Za-z_][A-Za-z_0-9]*$/.test(value)) return "variable";
  return "expression";
}
