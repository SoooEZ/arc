/**
 * The server trims a name or an expression with Java's String.trim before it
 * reads it: every UTF-16 code unit up to U+0020 goes, and nothing else. A
 * JavaScript trim also removes U+00A0, U+2028 and other Unicode spaces the
 * server keeps, so a field that judged the trimmed text would accept or refuse
 * what the server does not.
 */
export function trimAsServer(text: string): string {
  return text.replace(/^[\u0000-\u0020]+|[\u0000-\u0020]+$/g, "");
}

/**
 * The server's String.isBlank: Java's Character.isWhitespace for every
 * character. It counts the full-width space U+3000 and the other Unicode
 * spaces, but not the no-break spaces U+00A0, U+2007 and U+202F, which a
 * JavaScript \s would also match.
 */
const javaWhitespace =
  /^[\t-\r\u001c-\u0020\u1680\u2000-\u2006\u2008-\u200a\u2028\u2029\u205f\u3000]*$/;

export function isBlankAsServer(text: string): boolean {
  return javaWhitespace.test(text);
}
