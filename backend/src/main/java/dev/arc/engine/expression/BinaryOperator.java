package dev.arc.engine.expression;

/**
 * The infix operators, classified once when an expression is parsed. Evaluation switches on the
 * constant instead of matching the token text against sets on every operation.
 */
enum BinaryOperator {
  OR,
  AND,
  EQUAL,
  NOT_EQUAL,
  LESS,
  LESS_OR_EQUAL,
  GREATER,
  GREATER_OR_EQUAL,
  ADD,
  SUBTRACT,
  MULTIPLY,
  DIVIDE,
  REMAINDER,
  POWER;

  /**
   * The operator a token names ({@code =} and {@code <>} are aliases), or null for any other token.
   */
  static BinaryOperator of(String token) {
    return switch (token) {
      case "||", "OR" -> OR;
      case "&&", "AND" -> AND;
      case "==", "=" -> EQUAL;
      case "!=", "<>" -> NOT_EQUAL;
      case "<" -> LESS;
      case "<=" -> LESS_OR_EQUAL;
      case ">" -> GREATER;
      case ">=" -> GREATER_OR_EQUAL;
      case "+" -> ADD;
      case "-" -> SUBTRACT;
      case "*" -> MULTIPLY;
      case "/" -> DIVIDE;
      case "%" -> REMAINDER;
      case "^" -> POWER;
      default -> null;
    };
  }

  /** Binding strength; unary operators bind at 7, between the arithmetic operators and power. */
  int priority() {
    return switch (this) {
      case OR -> 1;
      case AND -> 2;
      case EQUAL, NOT_EQUAL -> 3;
      case LESS, LESS_OR_EQUAL, GREATER, GREATER_OR_EQUAL -> 4;
      case ADD, SUBTRACT -> 5;
      case MULTIPLY, DIVIDE, REMAINDER -> 6;
      case POWER -> 8;
    };
  }

  /** Power associates right-to-left; every other operator left-to-right. */
  boolean rightAssociative() {
    return this == POWER;
  }
}
