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

/**
 * The server's StorableText.problem: PostgreSQL text cannot hold U+0000, and
 * the JDBC driver turns an unpaired UTF-16 surrogate into '?'. Null for text
 * it stores as written, else the server's message.
 */
export function storableTextProblem(text: string): string | null {
  if (text.includes("\u0000"))
    return "Text cannot contain the NUL character (U+0000)";
  if (
    /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(
      text,
    )
  )
    return "Text cannot contain an unpaired UTF-16 surrogate";
  return null;
}
