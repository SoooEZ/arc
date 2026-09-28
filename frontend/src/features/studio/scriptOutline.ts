/** `node <id>` at a statement start; the keyword is case-insensitive, the ID is not. */
const nodeHeader = /node\s+("(?:[^"\\]|\\.)*"|[A-Za-z_][A-Za-z_0-9-]*)(?=\s)/iy;

/** The node ID a header at `offset` declares, or null when no header starts there. */
function declaredNodeId(source: string, offset: number): string | null {
  nodeHeader.lastIndex = offset;
  const token = nodeHeader.exec(source)?.[1];
  if (!token) return null;
  if (!token.startsWith('"')) return token;
  try {
    // Quoted IDs are strict JSON strings, as in the backend scanner.
    const id: unknown = JSON.parse(token);
    return typeof id === "string" ? id : null;
  } catch {
    return null;
  }
}

/** The index just past a quoted string that opens at `start`, or the source end. */
function stringEnd(source: string, start: number): number {
  const quote = source[start];
  for (let index = start + 1; index < source.length; index++) {
    if (source[index] === "\\") index++;
    else if (source[index] === quote) return index + 1;
  }
  return source.length;
}

/**
 * The offset of the header that declares `nodeId` in ARC Script, or null.
 * Like the backend scanner, it skips `//` comments and quoted strings and reads
 * headers only between top-level statements, so a note, a string or a node
 * body that mentions another declaration cannot match. IDs that differ only by
 * case are different nodes.
 */
export function nodeDeclarationOffset(
  source: string,
  nodeId: string,
): number | null {
  let depth = 0;
  let statementStart = true;
  let index = 0;
  while (index < source.length) {
    const character = source[index];
    if (/\s/.test(character)) {
      index++;
    } else if (source.startsWith("//", index)) {
      const lineEnd = source.indexOf("\n", index);
      index = lineEnd === -1 ? source.length : lineEnd;
    } else if (character === '"' || character === "'") {
      index = stringEnd(source, index);
      statementStart = false;
    } else {
      if (!depth && statementStart && declaredNodeId(source, index) === nodeId)
        return index;
      if (character === "{") depth++;
      if (character === "}") depth = Math.max(0, depth - 1);
      statementStart = !depth && (character === ";" || character === "}");
      index++;
    }
  }
  return null;
}
