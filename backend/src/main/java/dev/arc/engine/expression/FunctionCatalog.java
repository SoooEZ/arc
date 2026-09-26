package dev.arc.engine.expression;

import dev.arc.engine.expression.BuiltinFunctionCatalog.Spec;
import dev.arc.engine.expression.Functions.Entry;
import dev.arc.error.ArcException;
import java.util.*;
import org.apache.poi.ss.formula.atp.AnalysisToolPak;
import org.apache.poi.ss.formula.eval.FunctionEval;
import org.apache.poi.ss.formula.function.FunctionMetadataRegistry;

/** Immutable editor capabilities and arity validation, built once at startup. */
final class FunctionCatalog {
  private static final Map<String, Spec> CUSTOM = BuiltinFunctionCatalog.specs();
  private static final Set<String> CONTEXT =
      Set.of(
          "INDIRECT",
          "OFFSET",
          "CELL",
          "INFO",
          "ROW",
          "COLUMN",
          "HYPERLINK",
          "RTD",
          "WEBSERVICE",
          "NOW",
          "TODAY",
          "RAND",
          "RANDBETWEEN");
  private static final Set<String> EXCEL = executableExcelFunctions();

  private static final List<Entry> CATALOG = buildCatalog();

  private static Set<String> executableExcelFunctions() {
    var names = new TreeSet<>(FunctionEval.getSupportedFunctionNames());
    // These functions need workbook state or nondeterministic host data.
    names.removeAll(CONTEXT);
    return Set.copyOf(names);
  }

  private static List<Entry> buildCatalog() {
    var all = new TreeMap<String, Entry>();
    Set<String> names = new TreeSet<>(EXCEL);
    names.addAll(FunctionEval.getNotSupportedFunctionNames());
    names.addAll(AnalysisToolPak.getSupportedFunctionNames());
    names.addAll(AnalysisToolPak.getNotSupportedFunctionNames());
    names.addAll(CONTEXT);
    for (String name : names) {
      Entry entry = excelEntry(name);
      all.put(name, ExcelFunctionHelp.describe(entry));
    }
    CUSTOM.forEach((name, spec) -> all.put(name, spec.entry()));
    return all.values().stream().map(FunctionCatalog::editorEntry).toList();
  }

  private static Entry editorEntry(Entry entry) {
    // Literal function dollars must survive Monaco's snippet parser; argument tab stops stay live.
    return new Entry(
        "$" + entry.name(),
        entry.category(),
        "$" + entry.signature(),
        entry.description(),
        "\\$" + entry.snippet(),
        entry.supported(),
        entry.origin());
  }

  private static Entry excelEntry(String name) {
    var metadata = FunctionMetadataRegistry.getFunctionByName(name);
    boolean supported = EXCEL.contains(name) && metadata != null;
    int argumentCount = metadata == null ? 1 : Math.min(4, metadata.getMinParams());
    var arguments = new ArrayList<String>();
    var placeholders = new ArrayList<String>();
    for (int index = 1; index <= argumentCount; index++) {
      arguments.add("argument" + index);
      placeholders.add("${" + index + ":value}");
    }
    String signature =
        name
            + "("
            + String.join(", ", arguments)
            + (metadata != null && metadata.getMaxParams() > argumentCount ? ", ..." : "")
            + ")";
    String description =
        supported
            ? "Excel-compatible calculation via Apache POI. Accepts "
                + metadata.getMinParams()
                + "–"
                + metadata.getMaxParams()
                + " arguments; arrays represent ranges. Uses Excel numeric semantics."
            : "Reference only: this function needs workbook context or is not implemented by"
                + " the ARC adapter.";
    return new Entry(
        name,
        ExcelFunctionCategories.category(name),
        signature,
        description,
        name + "(" + String.join(", ", placeholders) + ")",
        supported,
        "Excel / Apache POI");
  }

  static void arity(String name, int count) {
    if (name.equals("OBJECT") && count % 2 != 0)
      throw ArcException.invalid("OBJECT expects key/value pairs");
    Spec spec = CUSTOM.get(name);
    if (spec != null) {
      if (count < spec.minimumArguments() || count > spec.maximumArguments())
        throw ArcException.invalid("Invalid argument count for " + name);
      return;
    }
    var metadata = FunctionMetadataRegistry.getFunctionByName(name);
    if (!EXCEL.contains(name) || metadata == null)
      throw ArcException.invalid("Unsupported function: " + name + " (see function catalog)");
    if (count < metadata.getMinParams() || count > metadata.getMaxParams())
      throw ArcException.invalid("Invalid argument count for " + name);
  }

  static List<Entry> catalog() {
    return CATALOG;
  }

  private FunctionCatalog() {}
}
