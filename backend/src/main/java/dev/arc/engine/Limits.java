package dev.arc.engine;

import java.util.Locale;

/**
 * Size limits and execution budgets shared by draft validation, expression compilation, ARC Script
 * and execution. Producers and consumers read the same constant, so one component cannot accept or
 * generate data that another rejects. Execution timeouts belong to {@link ExecutionDeadline}.
 *
 * <p>Messages state limits below 1,000 by concatenating the constant, which keeps the message a
 * compile-time constant for eagerly built validation messages. Larger limits use {@link
 * #format(long)} for their thousands separator.
 */
public final class Limits {
  // Graph documents: draft saves enforce these even for unfinished graphs.

  /** Declared inputs per graph. */
  public static final int MAX_INPUTS = 50;

  /** A Reference binds each callee input at most once. */
  public static final int MAX_REFERENCE_BINDINGS = MAX_INPUTS;

  /** Nodes per graph. */
  public static final int MAX_NODES = 100;

  /** Connections per graph. */
  public static final int MAX_EDGES = 200;

  /** Graph notes, rendered as ARC Script comments. */
  public static final int MAX_NOTES = 500;

  /** Characters in one graph note. */
  public static final int MAX_NOTE_CHARACTERS = 2_000;

  /** Absolute value of either node position coordinate. */
  public static final int MAX_CANVAS_COORDINATE = 1_000_000;

  /** Node IDs: letters, digits, underscores and hyphens. */
  public static final int MAX_NODE_ID_CHARACTERS = 80;

  /** Connection IDs. */
  public static final int MAX_EDGE_ID_CHARACTERS = 100;

  /** Node and Switch case labels. */
  public static final int MAX_LABEL_CHARACTERS = 160;

  /** Ordered cases per Switch node. */
  public static final int MAX_SWITCH_CASES = 20;

  /** Switch case IDs; the connection handle {@code case:<id>} repeats the ID. */
  public static final int MAX_CASE_ID_CHARACTERS = 64;

  /** Field mappings per Transform node. */
  public static final int MAX_TRANSFORM_FIELDS = 50;

  /** Object keys that a rule creates: Transform field names and {@code $OBJECT} keys. */
  public static final int MAX_FIELD_NAME_CHARACTERS = 160;

  /** Parameters of one data source. */
  public static final int MAX_SOURCE_PARAMETERS = 20;

  /** A sourced input maps each source parameter at most once. */
  public static final int MAX_SOURCE_MAPPINGS = MAX_SOURCE_PARAMETERS;

  /** JSON Pointer that selects a field from a source response. */
  public static final int MAX_POINTER_CHARACTERS = 500;

  // Names and IDs

  /** Variables, inputs, results, Output names and source parameters. */
  public static final int MAX_IDENTIFIER_CHARACTERS = 64;

  /** Rule and data source IDs, which are also the stored primary keys. */
  public static final int MAX_RESOURCE_ID_CHARACTERS = 80;

  /** Rule and data source display names. */
  public static final int MAX_NAME_CHARACTERS = 160;

  /** Rule descriptions. */
  public static final int MAX_DESCRIPTION_CHARACTERS = 2_000;

  // Expression and ARC Script source

  /** Every stored expression: node, selector, case, field, binding and source mapping. */
  public static final int MAX_EXPRESSION_CHARACTERS = 2_000;

  /** Tokens in one expression. */
  public static final int MAX_EXPRESSION_TOKENS = 256;

  /** Nested operator, parenthesis and call levels while parsing one expression. */
  public static final int MAX_EXPRESSION_NESTING = 48;

  /** Embedded ARC Script parsing; HTTP separately limits the encoded request to 1 MiB of bytes. */
  public static final int MAX_SCRIPT_CHARACTERS = 1_048_576;

  // Requests and what an editor saves back

  /** A request body, in bytes. */
  public static final int MAX_REQUEST_BYTES = 1024 * 1024;

  /**
   * A draft or source configuration as responses write it, every number in plain decimals, in
   * bytes: an editor sends what it read back in one save, beside a name and a revision.
   */
  public static final int MAX_EDITABLE_JSON_BYTES = MAX_REQUEST_BYTES - 64 * 1024;

  // Values produced by inputs, expressions and sources

  /** Characters in one string value. */
  public static final int MAX_STRING_CHARACTERS = 2_000;

  /** Items in one array or fields in one object, including lookup table entries. */
  public static final int MAX_COLLECTION_ITEMS = 1_000;

  /** Elements visited in one value: every container, object key and item. */
  public static final int MAX_VALUE_ELEMENTS = 10_000;

  /** Levels of nested arrays and objects below a top-level value. */
  public static final int MAX_VALUE_DEPTH = 8;

  /** Significant digits of a decimal value. */
  public static final int MAX_NUMBER_PRECISION = 100;

  /** Absolute decimal scale, so neither {@code 1E-101} nor {@code 1E+101} is accepted. */
  public static final int MAX_NUMBER_SCALE = 100;

  // Execution budgets. Exhausting one is a LIMIT error that no fallback can hide.

  /**
   * Nested rule calls below the executed rule, through References and Formula calls. Static
   * source-binding validation rejects deeper reference chains with the same limit.
   */
  public static final int MAX_NESTING_DEPTH = 16;

  /** Executed nodes, shared by the executed rule and every nested call. */
  public static final int MAX_EXECUTION_STEPS = 1_000;

  /** Source reads, shared by the executed rule and every nested call. */
  public static final int MAX_SOURCE_READS = 50;

  /** Operations in one expression evaluation; its collection scopes share this budget. */
  public static final int MAX_EXPRESSION_OPERATIONS = 10_000;

  private Limits() {}

  /** Shows a limit as messages always have ("2,000"), independent of the JVM default locale. */
  public static String format(long limit) {
    return String.format(Locale.ROOT, "%,d", limit);
  }

  /**
   * Shows a byte size as messages state it: whole mebibytes as "1 MiB", whole kibibytes as "256
   * KiB", any other count as grouped bytes ("1,500 bytes").
   */
  public static String formatBytes(long bytes) {
    long kib = 1024, mib = kib * kib;
    if (bytes % mib == 0) return format(bytes / mib) + " MiB";
    if (bytes % kib == 0) return format(bytes / kib) + " KiB";
    return format(bytes) + " bytes";
  }
}
