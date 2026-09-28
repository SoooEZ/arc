package dev.arc.engine.expression;

/**
 * Functions that bind local identifiers and evaluate a body once per item: {@code $MAP(items, item,
 * body)} and its siblings, and {@code $REDUCE(items, item, acc, initial, body)}. The parser reads
 * their arguments as bindings and {@link ExpressionRuntime} runs them; each constant owns its
 * per-item step and final value there, so a listed function without code cannot compile.
 */
enum CollectionFunction {
  MAP,
  FILTER,
  ALL,
  ANY,
  REDUCE;

  /** The collection function a call names exactly, or null when the name is not one. */
  static CollectionFunction named(String name) {
    for (CollectionFunction function : values()) if (function.name().equals(name)) return function;
    return null;
  }

  /** Whether the call binds an accumulator besides the item, with its initial value. */
  boolean bindsAccumulator() {
    return switch (this) {
      case REDUCE -> true;
      case MAP, FILTER, ALL, ANY -> false;
    };
  }
}
