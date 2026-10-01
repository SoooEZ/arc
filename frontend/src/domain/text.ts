/** Names as an English list: "a", "a and b" or "a, b and c". */
export function listed(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * Text that a Markdown view (a Monaco hover) shows as written: every character
 * Markdown could read as formatting is escaped. Node labels, rule names and
 * default values are the user's; "Net *price*" lost its stars and
 * "[docs](https://…)" became a link.
 */
export function markdownText(text: string): string {
  return text.replace(/[\\`*_{}[\]()#+\-.!|<>~&]/g, "\\$&");
}
