import type { InputType } from "../types";
import {
  arrayLiteralProblem,
  isArrayLiteral,
  isNumberLiteral,
  literalText,
} from "./expressions";
import { formatLimit, MAX_EXPRESSION_CHARACTERS } from "./limits";
import { trimAsServer } from "./serverText";
import { isIdentifier } from "./identifiers";
import { placeholderLiteral } from "./placeholderLiterals";

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

/**
 * The literal a constant binding starts with after its type changes. Numbers,
 * booleans and arrays share the placeholders used for required values; a new
 * text constant starts empty rather than with the placeholder word, and NULL
 * is a real choice here, not a missing value.
 */
export const constantDefaults: Record<ConstantType, string> = {
  NUMBER: placeholderLiteral.NUMBER,
  STRING: '""',
  BOOLEAN: placeholderLiteral.BOOLEAN,
  ARRAY: placeholderLiteral.ARRAY,
  NULL: "null",
};

/** The literal type the server would read from `value`, or null for any other expression. */
export function inferConstantType(value: string): ConstantType | null {
  const text = trimAsServer(value);
  if (literalText(text) !== null) return "STRING";
  if (/^(true|false)$/i.test(text)) return "BOOLEAN";
  if (/^null$/i.test(text)) return "NULL";
  if (isNumberLiteral(text)) return "NUMBER";
  if (isArrayLiteral(text)) return "ARRAY";
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

const constantFormats: Partial<Record<ConstantType, string>> = {
  NUMBER: "Enter a number such as 42, -0.5 or 1e3.",
  ARRAY: 'Enter an array literal such as [1, "two", true].',
};

/**
 * A typed constant field keeps partial text while the user edits it. Name what
 * the server would reject; an empty field is left to the caller's required or
 * default handling.
 */
export function constantTextError(
  type: ConstantType,
  text: string,
): string | null {
  // A constant is stored as its literal, an expression the server bounds: a
  // text of 2,000 characters is 2,002 with its quotes, and the save failed.
  if (text.length > MAX_EXPRESSION_CHARACTERS)
    return `Constants are stored as expressions of at most ${formatLimit(MAX_EXPRESSION_CHARACTERS)} characters (this one has ${formatLimit(text.length)}).`;
  const format = constantFormats[type];
  if (!format || !text.trim() || inferConstantType(text) === type) return null;
  // A well-formed array that is too long for the server gets its own reason.
  if (type === "ARRAY") return arrayLiteralProblem(text) ?? format;
  return format;
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

/** The value source to show for a value the user has not edited in this control. */
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
  // Listed names cover stored names that predate identifier validation.
  if (variableNames.includes(value) || isIdentifier(value)) return "variable";
  return "expression";
}

/**
 * Sets or removes one parameter mapping, keeping the other mappings in order.
 * Parameter names are user names such as "__proto__", so the copy defines own
 * properties instead of assigning through the prototype.
 */
export function withBinding(
  bindings: Readonly<Record<string, string>> | null | undefined,
  name: string,
  value: string | undefined,
): Record<string, string> {
  const entries: [string, string][] = [];
  let replaced = false;
  for (const [key, mapped] of Object.entries(bindings ?? {})) {
    if (key !== name) entries.push([key, mapped]);
    else if (value !== undefined) {
      entries.push([key, value]);
      replaced = true;
    }
  }
  if (value !== undefined && !replaced) entries.push([name, value]);
  return Object.fromEntries(entries);
}

/**
 * The mapped names that `declared` does not list, in stored order: own keys
 * only, so "constructor" or "__proto__" counts exactly when it is mapped.
 */
export function undeclaredBindings(
  bindings: Readonly<Record<string, string>> | null | undefined,
  declared: Iterable<string>,
): string[] {
  const names = new Set(declared);
  return Object.keys(bindings ?? {}).filter((name) => !names.has(name));
}

/** The mappings without `names`, keeping the others in order. */
export function withoutBindings(
  bindings: Readonly<Record<string, string>> | null | undefined,
  names: Iterable<string>,
): Record<string, string> {
  let remaining = withBinding(bindings, "", undefined);
  for (const name of names) remaining = withBinding(remaining, name, undefined);
  return remaining;
}
