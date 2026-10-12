import { resourceIdSyntax } from "./resourceIds";

/**
 * The `@rule-id:version` reference of a published Formula, as the server reads
 * it: the rule's ID (`Identifiers.RESOURCE_ID`) and a version of digits without
 * a leading zero (`ExpressionParser.VERSION`), read as a Java int by the path
 * variable that serves it. The mirror check (scripts/check_mirrors.test.mjs)
 * compares the grammar and the bound with the Java sources. The lexers that
 * color references, the editor's word pattern, the hover and the snippets all
 * take the grammar from here.
 */

/** A version as the server's grammar reads it: digits without a leading zero. */
const versionSyntax = "[1-9][0-9]*";

/** The largest version a route or a reference can name: Java's Integer.MAX_VALUE. */
export const MAX_PUBLISHED_VERSION = 2_147_483_647;

/** A reference as it is typed, as a regular-expression source: the version may still be missing. */
export const formulaReferenceSyntax = `@${resourceIdSyntax}(?::${versionSyntax})?`;

const version = new RegExp(`^${versionSyntax}$`);
const call = new RegExp(`^@(${resourceIdSyntax}):(${versionSyntax})$`);

/** The version number a route or a link names, or null for text that names none. */
export function parsePublishedVersion(text: string | null): number | null {
  if (text === null || !version.test(text)) return null;
  const parsed = Number(text);
  return parsed <= MAX_PUBLISHED_VERSION ? parsed : null;
}

/** The rule ID and version of a complete call reference, or null when the server would read none. */
export function parseFormulaReference(
  text: string,
): { id: string; version: number } | null {
  const match = call.exec(text);
  if (!match) return null;
  const parsed = parsePublishedVersion(match[2]);
  return parsed === null ? null : { id: match[1], version: parsed };
}

/** The reference of a published Formula as a call writes it: `@tax-rate:3`. */
export function formulaReference(id: string, version: number): string {
  return `@${id}:${version}`;
}
