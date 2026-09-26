const identifier = /^[A-Za-z_][A-Za-z_0-9]{0,63}$/;
const reserved = new Set(["true", "false", "null", "and", "or"]);

export const parameterNameGuidance =
  "Use letters, digits, or _; start with a letter or _. No spaces or $. Maximum 64 characters.";

export function parameterNameError(name: unknown): string | null {
  if (typeof name !== "string" || !identifier.test(name))
    return parameterNameGuidance;
  if (reserved.has(name.toLowerCase()))
    return `${name} is reserved. Choose another parameter name.`;
  return null;
}

/** Empty names and keyword prefixes stay editable; validation handles their completed values. */
export function acceptsParameterNameEdit(name: string): boolean {
  return name === "" || identifier.test(name);
}
