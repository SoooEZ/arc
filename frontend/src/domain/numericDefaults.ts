type NumericDefault =
  { valid: true; value: number | null } | { valid: false; error: string };

const decimal = /^([+-]?)(\d*\.?\d*)(?:[eE]([+-]?\d+))?$/;

/** Compare decimal values at the JSON boundary, not binary floating-point precision. */
function normalizedDecimal(text: string): string {
  const [, sign, mantissa, power = "0"] = decimal.exec(text)!;
  const [integer, fraction = ""] = mantissa.split(".");
  const digits = (integer + fraction).replace(/^0+/, "");
  if (!digits) return "0";
  const coefficient = digits.replace(/0+$/, "");
  const exponent =
    BigInt(power) -
    BigInt(fraction.length) +
    BigInt(digits.length - coefficient.length);
  return `${sign === "-" ? "-" : ""}${coefficient}e${exponent}`;
}

export function parseNumericDefault(raw: string): NumericDefault {
  const text = raw.trim();
  if (!text) return { valid: true, value: null };
  if (!decimal.test(text) || !/[0-9]/.test(text.split(/[eE]/)[0]))
    return { valid: false, error: "Enter a valid number before saving" };
  const value = Number(text);
  if (!Number.isFinite(value))
    return { valid: false, error: "Enter a finite number before saving" };
  if (normalizedDecimal(text) !== normalizedDecimal(JSON.stringify(value)))
    return {
      valid: false,
      error:
        "This number would change when saved. Enter a value that can be stored exactly.",
    };
  return { valid: true, value };
}
