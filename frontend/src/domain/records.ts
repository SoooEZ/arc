/**
 * Reads a user-named key from a plain record. Bracket lookups also return
 * inherited members, so a node or parameter named "constructor", "toString" or
 * "__proto__" would otherwise read Object.prototype instead of a missing entry.
 */
export function ownValue<T>(
  record: Record<string, T> | null | undefined,
  key: string,
): T | undefined {
  return record && Object.hasOwn(record, key) ? record[key] : undefined;
}
