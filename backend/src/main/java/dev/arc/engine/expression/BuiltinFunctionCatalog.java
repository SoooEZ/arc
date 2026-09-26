package dev.arc.engine.expression;

import dev.arc.engine.expression.Functions.Entry;
import java.util.*;

/** ARC-owned help and arity, including decimal overrides for corresponding Excel functions. */
final class BuiltinFunctionCatalog {
  record Spec(int minimumArguments, int maximumArguments, Entry entry) {}

  private static final Map<String, Spec> SPECS = create();

  static Map<String, Spec> specs() {
    return SPECS;
  }

  private static Map<String, Spec> create() {
    var specs = new LinkedHashMap<String, Spec>();
    add(
        specs,
        "OBJECT",
        0,
        100,
        "Data transformation",
        "OBJECT(\"key\", value, ...)",
        "Builds an object from key/value pairs, including nested objects and arrays. Keys must be unique; $OBJECT() returns an empty object.",
        "OBJECT(\"${1:name}\", ${2:value})");
    add(
        specs,
        "MERGE",
        1,
        50,
        "Data transformation",
        "MERGE(object, ...)",
        "Creates a shallow merged object. Later objects replace matching fields; inputs stay unchanged.",
        "MERGE(${1:customer}, \\$OBJECT(\"${2:status}\", ${3:\"active\"}))");
    add(
        specs,
        "COALESCE",
        1,
        50,
        "Data transformation",
        "COALESCE(value, ..., fallback)",
        "Returns the first non-null value, evaluating only as far as needed. Empty text, zero and false are retained.",
        "COALESCE(${1:customer.name}, ${2:\"Unknown\"})");
    add(
        specs,
        "TO_NUMBER",
        1,
        1,
        "Data transformation",
        "TO_NUMBER(value)",
        "Converts numeric text to a decimal number without floating-point loss. Null stays null; invalid text is an error.",
        "TO_NUMBER(${1:\"12.50\"})");
    add(
        specs,
        "TO_STRING",
        1,
        1,
        "Data transformation",
        "TO_STRING(value)",
        "Converts a number or boolean to text. Null stays null; objects and arrays are rejected.",
        "TO_STRING(${1:amount})");
    add(
        specs,
        "TO_BOOLEAN",
        1,
        1,
        "Data transformation",
        "TO_BOOLEAN(value)",
        "Accepts a boolean or text true/false (ignoring case and outer whitespace). Null stays null; other values are rejected.",
        "TO_BOOLEAN(${1:\"true\"})");
    add(
        specs,
        "IF",
        3,
        3,
        "Logic",
        "IF(condition, yes, no)",
        "Evaluates only the selected branch.",
        "IF(${1:amount > 100}, ${2:0.1}, ${3:0})");
    add(
        specs,
        "IFERROR",
        2,
        2,
        "Logic",
        "IFERROR(expression, fallback)",
        "Returns fallback when evaluation fails.",
        "IFERROR(${1:amount / count}, ${2:0})");
    for (String n : List.of("AND", "OR", "XOR"))
      add(
          specs,
          n,
          1,
          255,
          "Logic",
          n + "(boolean, ...)",
          "Combines boolean values.",
          n + "(${1:true}, ${2:false})");
    add(specs, "NOT", 1, 1, "Logic", "NOT(boolean)", "Reverses a boolean.", "NOT(${1:true})");
    add(
        specs,
        "SWITCH",
        3,
        255,
        "Logic",
        "SWITCH(value, case, result, ..., default)",
        "Selects the first matching case; default is optional.",
        "SWITCH(${1:tier}, \"premium\", ${2:0.2}, ${3:0})");
    for (String n : List.of("SUM", "MIN", "MAX", "AVG", "AVERAGE", "COUNT", "MUL"))
      add(
          specs,
          n,
          1,
          255,
          "Math",
          n + "(number or array, ...)",
          "Aggregates numbers or nested numeric arrays with decimal arithmetic.",
          n + "(${1:values})");
    for (String n : List.of("ABS", "FLOOR", "CEIL"))
      add(
          specs,
          n,
          1,
          1,
          "Math",
          n + "(number)",
          "Decimal numeric operation; $FLOOR and $CEIL round to an integer.",
          n + "(${1:amount})");
    for (String n : List.of("ROUND", "ROUNDDOWN", "ROUNDUP"))
      add(
          specs,
          n,
          1,
          2,
          "Math",
          n + "(number, digits = 0)",
          "Rounds to -12…12 decimal places. $ROUND uses half up; $ROUNDDOWN toward zero; $ROUNDUP away from"
              + " zero.",
          n + "(${1:amount}, ${2:2})");
    for (String n : List.of("MAP", "FILTER", "ALL", "ANY"))
      add(
          specs,
          n,
          3,
          3,
          "Collections",
          n + "(array, item, expression)",
          "Binds item inside expression. Object fields support dot access. No host code runs.",
          n + "(${1:items}, item, ${2:item.price > 10})");
    add(
        specs,
        "REDUCE",
        5,
        5,
        "Collections",
        "REDUCE(array, item, acc, initial, expression)",
        "Folds an array with explicit local item and accumulator variables.",
        "REDUCE(${1:items}, item, acc, 0, acc + item.price)");
    add(
        specs,
        "PLUCK",
        2,
        3,
        "Collections",
        "PLUCK(array, \"field.path\", default = null)",
        "Extracts a field from each object; missing values use default.",
        "PLUCK(${1:items}, \"${2:price}\")");
    add(
        specs,
        "GET",
        2,
        3,
        "Collections",
        "GET(object, \"field.path\", default = null)",
        "Reads an object path or array index safely.",
        "GET(${1:customer}, \"${2:address.country}\", ${3:\"US\"})");
    add(
        specs,
        "CONTAINS",
        2,
        2,
        "Text",
        "CONTAINS(text or array, value)",
        "Checks text substring or array membership (case sensitive).",
        "CONTAINS(${1:name}, ${2:\"arc\"})");
    add(
        specs,
        "CONCAT",
        1,
        255,
        "Text",
        "CONCAT(value, ...)",
        "Joins scalar values or flattened arrays as text.",
        "CONCAT(${1:firstName}, \" \", ${2:lastName})");
    return Collections.unmodifiableMap(specs);
  }

  private static void add(
      Map<String, Spec> specs,
      String name,
      int min,
      int max,
      String category,
      String signature,
      String description,
      String snippet) {
    specs.put(
        name,
        new Spec(
            min,
            max,
            new Entry(
                name,
                category,
                signature,
                description,
                snippet,
                true,
                "ARC / Excel / Dentaku-style")));
  }

  private BuiltinFunctionCatalog() {}
}
