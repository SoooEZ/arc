package dev.arc.engine;

import dev.arc.engine.Functions.Entry;
import dev.arc.error.ArcException;
import java.util.*;
import org.apache.poi.ss.formula.atp.AnalysisToolPak;
import org.apache.poi.ss.formula.eval.FunctionEval;
import org.apache.poi.ss.formula.function.FunctionMetadataRegistry;

/** Immutable editor capabilities and arity validation, built once at startup. */
final class FunctionCatalog {
  private record Spec(int min, int max, Entry entry) {}

  private static final Map<String, Spec> CUSTOM = new LinkedHashMap<>();
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
  private static final Set<String> EXCEL = new TreeSet<>(FunctionEval.getSupportedFunctionNames());
  private static final Map<String, String> CATEGORIES = categories();

  private static Map<String, String> categories() {
    var groups = new LinkedHashMap<String, String>();
    groups.put(
        "Math",
        "CEILING CEILING.MATH CEILING.PRECISE COMBIN EVEN EXP FACT FACTDOUBLE FLOOR.MATH"
            + " FLOOR.PRECISE GCD INT LCM LN LOG LOG10 MOD MROUND MULTINOMIAL ODD PI POWER PRODUCT"
            + " QUOTIENT ROMAN SERIESSUM SIGN SQRT SQRTPI SUBTOTAL SUMIFS SUMSQ SUMX2MY2 SUMX2PY2"
            + " SUMXMY2 TRUNC");
    groups.put(
        "Trigonometry",
        "ACOS ACOSH ASIN ASINH ATAN ATAN2 ATANH COS COSH DEGREES RADIANS SIN SINH TAN TANH");
    groups.put(
        "Statistics",
        "AVEDEV AVERAGEA AVERAGEIF AVERAGEIFS CORREL COVAR COVARIANCE.P COVARIANCE.S DEVSQ FISHER"
            + " FISHERINV FORECAST FORECAST.LINEAR FREQUENCY GROWTH HARMEAN INTERCEPT KURT LARGE"
            + " LINEST LOGEST MAXA MAXIFS MINA MINIFS MODE PEARSON PERCENTILE PERCENTRANK"
            + " PERCENTRANK.EXC PERCENTRANK.INC PERMUT QUARTILE RANK RSQ SKEW SLOPE SMALL"
            + " STANDARDIZE STDEV.P STDEV.S STDEVA STDEVPA STEYX TREND TRIMMEAN VAR.P VAR.S VARA"
            + " VARPA");
    groups.put(
        "Probability",
        "BETADIST BETAINV BINOMDIST CHIDIST CHIINV CHITEST CONFIDENCE CRITBINOM EXPONDIST FDIST"
            + " FINV FTEST GAMMADIST GAMMAINV GAMMALN HYPGEOMDIST LOGINV LOGNORMDIST NEGBINOMDIST"
            + " NORM.DIST NORM.INV NORM.S.DIST NORM.S.INV NORMDIST NORMINV NORMSDIST NORMSINV"
            + " POISSON POISSON.DIST PROB T.DIST T.DIST.2T T.DIST.RT TDIST TINV TTEST WEIBULL"
            + " ZTEST");
    groups.put(
        "Text",
        "ASC BAHTTEXT CHAR CODE CONCATENATE DBCS DOLLAR EXACT FINDB FIXED JIS LEFTB LENB MIDB"
            + " NUMBERSTRING NUMBERVALUE PHONETIC REPLACE REPLACEB RIGHTB SEARCHB T TEXTJOIN"
            + " USDOLLAR VALUE");
    groups.put(
        "Date & time",
        "DATEDIF DATESTRING DATEVALUE DAYS DAYS360 EDATE EOMONTH HOUR MINUTE NETWORKDAYS SECOND"
            + " TIME TIMEVALUE WEEKNUM WORKDAY WORKDAY.INTL YEARFRAC NOW TODAY");
    groups.put(
        "Finance",
        "ACCRINT ACCRINTM AMORDEGRC AMORLINC COUPDAYBS COUPDAYS COUPDAYSNC COUPNCD COUPNUM COUPPCD"
            + " CUMIPMT CUMPRINC DB DDB DISC DOLLARDE DOLLARFR DURATION EFFECT FV FVSCHEDULE"
            + " INTRATE IPMT IRR ISPMT MDURATION MIRR NOMINAL NPER ODDFPRICE ODDFYIELD ODDLPRICE"
            + " ODDLYIELD PPMT PRICE PRICEDISC PRICEMAT PV RATE RECEIVED SLN SYD TBILLEQ TBILLPRICE"
            + " TBILLYIELD VDB XIRR XNPV YIELD YIELDDISC YIELDMAT");
    groups.put("Logic", "FALSE TRUE IFNA IFS");
    groups.put(
        "Type & error checks",
        "ERROR.TYPE ISBLANK ISERR ISERROR ISEVEN ISLOGICAL ISNA ISNONTEXT ISNUMBER ISODD ISREF"
            + " ISTEXT N NA TYPE");
    groups.put("Lookup", "ADDRESS AREAS CHOOSE COLUMNS DGET LOOKUP ROWS TRANSPOSE XLOOKUP XMATCH");
    groups.put("Collections", "COUNTA COUNTBLANK COUNTIFS");
    groups.put(
        "Database", "DAVERAGE DCOUNT DCOUNTA DMAX DMIN DPRODUCT DSTDEV DSTDEVP DSUM DVAR DVARP");
    groups.put("Matrices", "MDETERM MINVERSE MMULT");
    groups.put(
        "Engineering",
        "BESSELI BESSELJ BESSELK BESSELY BIN2DEC BIN2HEX BIN2OCT COMPLEX CONVERT DEC2BIN DEC2HEX"
            + " DEC2OCT DELTA ERF ERFC GESTEP HEX2BIN HEX2DEC HEX2OCT IMABS IMAGINARY IMARGUMENT"
            + " IMCONJUGATE IMCOS IMDIV IMEXP IMLN IMLOG10 IMLOG2 IMPOWER IMPRODUCT IMREAL IMSIN"
            + " IMSQRT IMSUB IMSUM OCT2BIN OCT2DEC OCT2HEX");
    var result = new HashMap<String, String>();
    groups.forEach(
        (category, names) -> {
          for (String name : names.split(" ")) result.put(name, category);
        });
    return Map.copyOf(result);
  }

  static {
    add(
        "IF",
        3,
        3,
        "Logic",
        "IF(condition, yes, no)",
        "Evaluates only the selected branch.",
        "IF(${1:amount > 100}, ${2:0.1}, ${3:0})");
    add(
        "IFERROR",
        2,
        2,
        "Logic",
        "IFERROR(expression, fallback)",
        "Returns fallback when evaluation fails.",
        "IFERROR(${1:amount / count}, ${2:0})");
    for (String n : List.of("AND", "OR", "XOR"))
      add(
          n,
          1,
          255,
          "Logic",
          n + "(boolean, ...)",
          "Combines boolean values.",
          n + "(${1:true}, ${2:false})");
    add("NOT", 1, 1, "Logic", "NOT(boolean)", "Reverses a boolean.", "NOT(${1:true})");
    add(
        "SWITCH",
        3,
        255,
        "Logic",
        "SWITCH(value, case, result, ..., default)",
        "Selects the first matching case; default is optional.",
        "SWITCH(${1:tier}, \"premium\", ${2:0.2}, ${3:0})");
    for (String n : List.of("SUM", "MIN", "MAX", "AVG", "AVERAGE", "COUNT", "MUL"))
      add(
          n,
          1,
          255,
          "Math",
          n + "(number or array, ...)",
          "Aggregates numbers or nested numeric arrays with decimal arithmetic.",
          n + "(${1:values})");
    for (String n : List.of("ABS", "FLOOR", "CEIL"))
      add(
          n,
          1,
          1,
          "Math",
          n + "(number)",
          "Decimal numeric operation; FLOOR and CEIL round to an integer.",
          n + "(${1:amount})");
    for (String n : List.of("ROUND", "ROUNDDOWN", "ROUNDUP"))
      add(
          n,
          1,
          2,
          "Math",
          n + "(number, digits = 0)",
          "Rounds to -12…12 decimal places. ROUND uses half up; DOWN toward zero; UP away from"
              + " zero.",
          n + "(${1:amount}, ${2:2})");
    for (String n : List.of("MAP", "FILTER", "ALL", "ANY"))
      add(
          n,
          3,
          3,
          "Collections",
          n + "(array, item, expression)",
          "Binds item inside expression. Object fields support dot access. No host code runs.",
          n + "(${1:items}, item, ${2:item.price > 10})");
    add(
        "REDUCE",
        5,
        5,
        "Collections",
        "REDUCE(array, item, acc, initial, expression)",
        "Folds an array with explicit local item and accumulator variables.",
        "REDUCE(${1:items}, item, acc, 0, acc + item.price)");
    add(
        "PLUCK",
        2,
        3,
        "Collections",
        "PLUCK(array, \"field.path\", default = null)",
        "Extracts a field from each object; missing values use default.",
        "PLUCK(${1:items}, \"${2:price}\")");
    add(
        "GET",
        2,
        3,
        "Collections",
        "GET(object, \"field.path\", default = null)",
        "Reads an object path or array index safely.",
        "GET(${1:customer}, \"${2:address.country}\", ${3:\"US\"})");
    add(
        "CONTAINS",
        2,
        2,
        "Text",
        "CONTAINS(text or array, value)",
        "Checks text substring or array membership (case sensitive).",
        "CONTAINS(${1:name}, ${2:\"arc\"})");
    add(
        "CONCAT",
        1,
        255,
        "Text",
        "CONCAT(value, ...)",
        "Joins scalar values or flattened arrays as text.",
        "CONCAT(${1:firstName}, \" \", ${2:lastName})");
    // POI also exposes functions which require workbook state; these are reference-only here.
    EXCEL.removeAll(CONTEXT);
  }

  private static void add(
      String n, int min, int max, String group, String sig, String desc, String snippet) {
    CUSTOM.put(
        n,
        new Spec(
            min,
            max,
            new Entry(n, group, sig, desc, snippet, true, "ARC / Excel / Dentaku-style")));
  }

  private static final Map<String, String[]> HELP = new HashMap<>();

  static {
    help(
        "LEFT",
        "Text",
        "LEFT(text, characters = 1)",
        "Takes characters from the start of a string.",
        "LEFT(${1:\"text\"}, ${2:3})");
    help(
        "RIGHT",
        "Text",
        "RIGHT(text, characters = 1)",
        "Takes characters from the end of a string.",
        "RIGHT(${1:\"text\"}, ${2:3})");
    help(
        "MID",
        "Text",
        "MID(text, start, count)",
        "Extracts characters; start is one-based.",
        "MID(${1:\"hello\"}, ${2:2}, ${3:3})");
    help("LEN", "Text", "LEN(text)", "Counts characters in a string.", "LEN(${1:\"text\"})");
    help(
        "FIND",
        "Text",
        "FIND(needle, text, start = 1)",
        "Returns the one-based, case-sensitive position. Missing text is an error.",
        "FIND(${1:\"a\"}, ${2:\"arc\"})");
    help(
        "SEARCH",
        "Text",
        "SEARCH(needle, text, start = 1)",
        "Finds a case-insensitive, one-based text position.",
        "SEARCH(${1:\"a\"}, ${2:\"ARC\"})");
    help(
        "SUBSTITUTE",
        "Text",
        "SUBSTITUTE(text, old, replacement, occurrence?)",
        "Replaces all matches, or only the selected occurrence.",
        "SUBSTITUTE(${1:\"hello\"}, ${2:\"l\"}, ${3:\"r\"})");
    help(
        "TEXT",
        "Text",
        "TEXT(value, format)",
        "Formats a number using an Excel format string.",
        "TEXT(${1:amount}, ${2:\"0.00\"})");
    for (String n : List.of("UPPER", "LOWER", "PROPER", "TRIM", "CLEAN"))
      help(
          n,
          "Text",
          n + "(text)",
          "Transforms text: letter case, whitespace, or nonprinting characters.",
          n + "(${1:\"text\"})");
    help(
        "REPT",
        "Text",
        "REPT(text, count)",
        "Repeats text. ARC limits the result to 2,000 characters.",
        "REPT(${1:\"x\"}, ${2:3})");
    help(
        "VLOOKUP",
        "Lookup",
        "VLOOKUP(key, table, column, approximate = true)",
        "Searches the first column. Columns are one-based; false requests an exact match."
            + " Approximate tables must be sorted.",
        "VLOOKUP(${1:key}, ${2:[[1, 10], [2, 20]]}, ${3:2}, false)");
    help(
        "HLOOKUP",
        "Lookup",
        "HLOOKUP(key, table, row, approximate = true)",
        "Searches the first row. Rows are one-based; false requests an exact match.",
        "HLOOKUP(${1:key}, ${2:[[1, 2], [10, 20]]}, ${3:2}, false)");
    help(
        "INDEX",
        "Lookup",
        "INDEX(array, row, column?)",
        "Returns a one-based position within an array or matrix.",
        "INDEX(${1:values}, ${2:1}, ${3:1})");
    help(
        "MATCH",
        "Lookup",
        "MATCH(key, array, matchType = 1)",
        "Returns a one-based matching position. Use 0 for an exact match.",
        "MATCH(${1:key}, ${2:values}, 0)");
    help(
        "COUNTIF",
        "Statistics",
        "COUNTIF(range, criteria)",
        "Counts cells matching an Excel criterion such as >10 or a text value.",
        "COUNTIF(${1:values}, ${2:\">10\"})");
    help(
        "SUMIF",
        "Statistics",
        "SUMIF(range, criteria, sumRange?)",
        "Sums matching cells, optionally from a separate range.",
        "SUMIF(${1:values}, ${2:\">10\"})");
    help(
        "SUMPRODUCT",
        "Math",
        "SUMPRODUCT(array, ...)",
        "Multiplies matching positions then adds the products.",
        "SUMPRODUCT(${1:prices}, ${2:quantities})");
    help(
        "ROUNDUP",
        "Math",
        "ROUNDUP(number, digits = 0)",
        "Rounds away from zero.",
        "ROUNDUP(${1:amount}, ${2:2})");
    for (String n : List.of("MEDIAN", "STDEV", "STDEVP", "VAR", "VARP", "GEOMEAN"))
      help(
          n,
          "Statistics",
          n + "(number or array, ...)",
          "Calculates an Excel statistical measure over the supplied numeric values.",
          n + "(${1:values})");
    help(
        "DATE",
        "Date & time",
        "DATE(year, month, day)",
        "Returns an Excel serial date (1900 date system). No system clock is read.",
        "DATE(${1:2026}, ${2:9}, ${3:16})");
    for (String n : List.of("YEAR", "MONTH", "DAY", "WEEKDAY"))
      help(
          n,
          "Date & time",
          n + "(serialDate)",
          "Extracts a calendar component from an Excel serial date.",
          n + "(${1:DATE(2026, 9, 16)})");
    help(
        "PMT",
        "Finance",
        "PMT(rate, periods, presentValue, futureValue = 0, type = 0)",
        "Calculates a periodic payment using a rate per period. Type 0 pays at period end.",
        "PMT(${1:0.05 / 12}, ${2:60}, ${3:10000})");
    help(
        "NPV",
        "Finance",
        "NPV(rate, cashflow, ...)",
        "Discounts future cash flows at a constant per-period rate.",
        "NPV(${1:0.1}, ${2:[100, 200, 300]})");
  }

  private static void help(
      String name, String category, String signature, String description, String snippet) {
    HELP.put(name, new String[] {category, signature, description, snippet});
  }

  private static List<Entry> buildCatalog() {
    var all = new TreeMap<String, Entry>();
    Set<String> names = new TreeSet<>(EXCEL);
    names.addAll(FunctionEval.getNotSupportedFunctionNames());
    names.addAll(AnalysisToolPak.getSupportedFunctionNames());
    names.addAll(AnalysisToolPak.getNotSupportedFunctionNames());
    names.addAll(CONTEXT);
    for (String name : names) {
      var m = FunctionMetadataRegistry.getFunctionByName(name);
      boolean supported = EXCEL.contains(name) && m != null;
      int count = m == null ? 1 : Math.min(4, m.getMinParams());
      String args =
          String.join(
              ", ",
              java.util.stream.IntStream.range(0, count)
                  .mapToObj(i -> "argument" + (i + 1))
                  .toList());
      String snippet =
          name
              + "("
              + String.join(
                  ", ",
                  java.util.stream.IntStream.range(0, count)
                      .mapToObj(i -> "${" + (i + 1) + ":value}")
                      .toList())
              + ")";
      all.put(
          name,
          new Entry(
              name,
              CATEGORIES.getOrDefault(name, "Workbook & other"),
              name + "(" + args + (m != null && m.getMaxParams() > count ? ", ..." : "") + ")",
              supported
                  ? "Excel-compatible calculation via Apache POI. Accepts "
                      + m.getMinParams()
                      + "–"
                      + m.getMaxParams()
                      + " arguments; arrays represent ranges. Uses Excel numeric semantics."
                  : "Reference only: this function needs workbook context or is not implemented by"
                      + " the ARC adapter.",
              snippet,
              supported,
              "Excel / Apache POI"));
    }
    HELP.forEach(
        (n, h) -> {
          var entry = all.get(n);
          if (entry != null)
            all.put(n, new Entry(n, h[0], h[1], h[2], h[3], entry.supported(), entry.origin()));
        });
    CUSTOM.forEach((n, s) -> all.put(n, s.entry()));
    return List.copyOf(all.values());
  }

  public static void arity(String name, int count) {
    Spec spec = CUSTOM.get(name);
    if (spec != null) {
      if (count < spec.min || count > spec.max)
        throw ArcException.invalid("Invalid argument count for " + name);
      return;
    }
    var m = FunctionMetadataRegistry.getFunctionByName(name);
    if (!EXCEL.contains(name) || m == null)
      throw ArcException.invalid("Unsupported function: " + name + " (see function catalog)");
    if (count < m.getMinParams() || count > m.getMaxParams())
      throw ArcException.invalid("Invalid argument count for " + name);
  }

  private static final List<Entry> CATALOG = buildCatalog();

  static List<Entry> catalog() {
    return CATALOG;
  }

  private FunctionCatalog() {}
}
