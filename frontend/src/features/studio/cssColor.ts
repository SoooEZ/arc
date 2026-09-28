/**
 * A CSS color as Monaco takes it, `#rrggbb`, from the spellings a design token
 * may use: 3-, 4-, 6- or 8-digit hex and `rgb()`/`rgba()`. Null for anything
 * else (a keyword, `hsl()`, an unresolved `var()`), so the caller can fall
 * back instead of painting black.
 */
export function parseCssColor(value: string): string | null {
  const text = value.trim();
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(text);
  if (hex) {
    const digits = hex[1];
    const expanded =
      digits.length <= 4
        ? [...digits].map((digit) => digit + digit).join("")
        : digits;
    return `#${expanded.slice(0, 6).toLowerCase()}`;
  }
  const rgb =
    /^rgba?\(\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*(?:[,/]\s*[\d.]+%?\s*)?\)$/i.exec(
      text,
    );
  if (!rgb) return null;
  const channels = rgb.slice(1, 4).map(Number);
  if (channels.some((channel) => channel > 255)) return null;
  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}
