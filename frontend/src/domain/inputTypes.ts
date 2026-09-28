import type { InputType } from "../types";

/**
 * One descriptor per declared input type, in the order the type menu offers
 * them. The server keeps the same list in `engine.InputTypes.NAMES` (the mirror
 * check compares them), and its ARC Script grammar reads a declaration's type in
 * any case, so `inputTypeOf` upper-cases before it looks the name up.
 */
export const inputTypeFacts: Record<InputType, { label: string }> = {
  NUMBER: { label: "number" },
  STRING: { label: "string" },
  BOOLEAN: { label: "boolean" },
  ARRAY: { label: "array" },
  OBJECT: { label: "object" },
};

export const inputTypes: readonly InputType[] = Object.keys(
  inputTypeFacts,
) as InputType[];

/** The declared type `text` names in any case, or null (never an inherited property such as "constructor"). */
export function inputTypeOf(text: string | undefined): InputType | null {
  if (!text) return null;
  const name = text.toUpperCase();
  return Object.hasOwn(inputTypeFacts, name) ? (name as InputType) : null;
}
