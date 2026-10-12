package dev.arc.engine;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.core.JsonToken;
import com.fasterxml.jackson.core.util.JsonParserDelegate;
import java.io.IOException;

/**
 * Applies the collection, depth and text bounds of {@link ValueBounds} token by token while a JSON
 * document is parsed, so an oversized document fails at the first bound it exceeds instead of after
 * it has been built in full: a 1 MiB body of empty arrays became some 350,000 lists (18 MB) before
 * the walk over the result threw at element 10,001. Every container, key and item counts as an
 * element, a key or string is bounded by its length, a container by its items and by its depth, as
 * in the walk; numbers are left to the walk, which remains the arbiter over the built value. A
 * document that exceeds several bounds reports the first one met while streaming, which can differ
 * from the walk's order: the walk sees an array's size before its first item.
 */
public final class BoundedJsonParser extends JsonParserDelegate {
  /** Items counted so far in each open container, by its depth; deeper containers are refused. */
  private final int[] items = new int[Limits.MAX_VALUE_DEPTH + 1];

  private final boolean[] arrays = new boolean[Limits.MAX_VALUE_DEPTH + 1];
  private int depth;
  private int elements;

  public BoundedJsonParser(JsonParser parser) {
    super(parser);
  }

  @Override
  public JsonToken nextToken() throws IOException {
    JsonToken token = delegate.nextToken();
    if (token == null) return null;
    if (token.isStructEnd()) {
      depth--;
      return token;
    }
    if (token == JsonToken.FIELD_NAME) {
      if (++items[depth - 1] > Limits.MAX_COLLECTION_ITEMS) throw ValueBounds.objectTooLarge();
      countElement();
      checkText();
      return token;
    }
    if (depth > 0 && arrays[depth - 1] && ++items[depth - 1] > Limits.MAX_COLLECTION_ITEMS)
      throw ValueBounds.arrayTooLarge();
    countElement();
    if (token == JsonToken.VALUE_STRING) checkText();
    if (token.isStructStart()) {
      arrays[depth] = token == JsonToken.START_ARRAY;
      items[depth] = 0;
      depth++;
    }
    return token;
  }

  /** The delegate's own shortcut would bypass {@link #nextToken}. */
  @Override
  public JsonToken nextValue() throws IOException {
    JsonToken token = nextToken();
    return token == JsonToken.FIELD_NAME ? nextToken() : token;
  }

  @Override
  public JsonParser skipChildren() throws IOException {
    JsonToken current = currentToken();
    if (current == null || !current.isStructStart()) return this;
    for (int open = 1; open > 0; ) {
      JsonToken token = nextToken();
      if (token == null) break;
      if (token.isStructStart()) open++;
      else if (token.isStructEnd()) open--;
    }
    return this;
  }

  /** A token is at the depth of the containers open around it; the root is at depth 0. */
  private void countElement() {
    if (depth > Limits.MAX_VALUE_DEPTH || ++elements > Limits.MAX_VALUE_ELEMENTS)
      throw ValueBounds.depthOrSizeExceeded();
  }

  private void checkText() throws IOException {
    if (getTextLength() > Limits.MAX_STRING_CHARACTERS) throw ValueBounds.stringTooLong();
  }
}
