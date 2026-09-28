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
