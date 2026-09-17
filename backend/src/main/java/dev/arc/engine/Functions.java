package dev.arc.engine;

import dev.arc.api.ArcException;
import java.math.*;
import java.util.*;
import org.apache.poi.ss.formula.CacheAreaEval;
import org.apache.poi.ss.formula.atp.AnalysisToolPak;
import org.apache.poi.ss.formula.eval.*;
import org.apache.poi.ss.formula.function.FunctionMetadataRegistry;

/** Catalog and evaluator share one registry, so editor capabilities cannot drift from runtime. */
public final class Functions {
  public record Entry(
      String name,
      String category,
      String signature,
      String description,
      String snippet,
      boolean supported,
      String origin) {}

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

  public static List<Entry> catalog() {
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

  public static Object call(String name, List<Object> args) {
    if (List.of("SUM", "MIN", "MAX", "AVG", "AVERAGE", "COUNT", "MUL").contains(name)) {
      List<Object> flat = flatten(args);
      List<BigDecimal> ns = flat.stream().map(Expressions::number).toList();
      if (name.equals("COUNT")) return BigDecimal.valueOf(ns.size());
      if (ns.isEmpty() && !name.equals("SUM") && !name.equals("MUL"))
        throw ArcException.invalid(name + " requires values");
      return switch (name) {
        case "MIN" -> ns.stream().min(BigDecimal::compareTo).orElseThrow();
        case "MAX" -> ns.stream().max(BigDecimal::compareTo).orElseThrow();
        case "MUL" -> ns.stream().reduce(BigDecimal.ONE, (a, b) -> a.multiply(b, Expressions.MATH));
        default -> {
          var sum = ns.stream().reduce(BigDecimal.ZERO, (a, b) -> a.add(b, Expressions.MATH));
          yield name.equals("AVG") || name.equals("AVERAGE")
              ? sum.divide(BigDecimal.valueOf(ns.size()), Expressions.MATH)
              : sum;
        }
      };
    }
    Object first = args.isEmpty() ? null : args.getFirst();
    switch (name) {
      case "ABS":
        return Expressions.number(first).abs();
      case "FLOOR":
        return Expressions.number(first).setScale(0, RoundingMode.FLOOR);
      case "CEIL":
        return Expressions.number(first).setScale(0, RoundingMode.CEILING);
      case "ROUND":
      case "ROUNDDOWN":
      case "ROUNDUP":
        {
          int scale = 0;
          try {
            if (args.size() > 1) scale = Expressions.number(args.get(1)).intValueExact();
          } catch (ArithmeticException e) {
            throw ArcException.invalid("Round precision must be an integer");
          }
          if (Math.abs(scale) > 12) throw ArcException.invalid("Round precision must be -12 to 12");
          return Expressions.number(first)
              .setScale(
                  scale,
                  name.equals("ROUND")
                      ? RoundingMode.HALF_UP
                      : name.equals("ROUNDUP") ? RoundingMode.UP : RoundingMode.DOWN);
        }
      case "NOT":
        return !Expressions.bool(first);
      case "AND":
        return args.stream().allMatch(Expressions::bool);
      case "OR":
        return args.stream().anyMatch(Expressions::bool);
      case "XOR":
        return args.stream().filter(Expressions::bool).count() % 2 == 1;
      case "CONTAINS":
        return first instanceof List<?> xs
            ? xs.stream().anyMatch(x -> Expressions.equal(x, args.get(1)))
            : String.valueOf(first).contains(String.valueOf(args.get(1)));
      case "CONCAT":
        return String.join(
            "", flatten(args).stream().map(v -> v == null ? "" : v.toString()).toList());
      case "GET":
        return get(first, String.valueOf(args.get(1)), args.size() == 3 ? args.get(2) : null);
      case "PLUCK":
        return array(first).stream()
            .map(v -> get(v, String.valueOf(args.get(1)), args.size() == 3 ? args.get(2) : null))
            .toList();
      default:
        return excel(name, args);
    }
  }

  public static List<?> array(Object value) {
    if (!(value instanceof List<?> list)) throw ArcException.invalid("Expected an array");
    return list;
  }

  public static Object get(Object value, String path, Object fallback) {
    for (String part : path.split("\\.")) {
      if (value instanceof Map<?, ?> m && m.containsKey(part)) value = m.get(part);
      else if (value instanceof List<?> a
          && part.matches("\\d{1,6}")
          && Integer.parseInt(part) < a.size()) value = a.get(Integer.parseInt(part));
      else return fallback;
    }
    return value;
  }

  private static List<Object> flatten(List<?> args) {
    var out = new ArrayList<Object>();
    for (Object x : args) {
      if (x instanceof List<?> a) out.addAll(flatten(a));
      else out.add(x);
      if (out.size() > 10000) throw ArcException.invalid("Too many array values");
    }
    return out;
  }

  private static ValueEval value(Object x) {
    if (x == null) return BlankEval.instance;
    if (x instanceof Number n) return new NumberEval(n.doubleValue());
    if (x instanceof Boolean b) return BoolEval.valueOf(b);
    if (x instanceof String s) return new StringEval(s);
    if (x instanceof List<?> a) {
      if (a.isEmpty()) return new CacheAreaEval(0, 0, 0, 0, new ValueEval[] {BlankEval.instance});
      int cols = a.getFirst() instanceof List<?> row ? row.size() : 1;
      if (cols == 0) throw ArcException.invalid("Excel ranges cannot contain empty rows");
      var vals = new ArrayList<ValueEval>();
      for (Object r : a) {
        List<?> row = r instanceof List<?> l ? l : Collections.singletonList(r);
        if (row.size() != cols) throw ArcException.invalid("Excel ranges must be rectangular");
        for (Object v : row) {
          if (v instanceof List<?> || v instanceof Map<?, ?>)
            throw ArcException.invalid("Excel range cells must be scalars");
          vals.add(value(v));
        }
      }
      return new CacheAreaEval(0, 0, a.size() - 1, cols - 1, vals.toArray(ValueEval[]::new));
    }
    throw ArcException.invalid("Excel functions require scalars or rectangular arrays");
  }

  private static Object converted(ValueEval result, String name) {
    if (result instanceof ErrorEval e) throw ArcException.invalid(name + ": " + e.getErrorString());
    if (result instanceof BoolEval b) return b.getBooleanValue();
    if (result instanceof NumberEval n) {
      if (!Double.isFinite(n.getNumberValue()))
        throw ArcException.invalid(name + ": non-finite result");
      return BigDecimal.valueOf(n.getNumberValue()).stripTrailingZeros();
    }
    if (result instanceof StringEval s) return s.getStringValue();
    if (result instanceof BlankEval) return null;
    if (result instanceof RefEval r)
      return converted(r.getInnerValueEval(r.getFirstSheetIndex()), name);
    if (result instanceof AreaEval area) {
      if (area.getHeight() > 1000
          || area.getWidth() > 1000
          || (long) area.getHeight() * area.getWidth() > 10000)
        throw ArcException.invalid("Excel result exceeds array limits");
      if (area.getHeight() == 1 && area.getWidth() == 1)
        return converted(area.getRelativeValue(0, 0), name);
      var rows = new ArrayList<Object>();
      for (int y = 0; y < area.getHeight(); y++) {
        var row = new ArrayList<Object>();
        for (int x = 0; x < area.getWidth(); x++)
          row.add(converted(area.getRelativeValue(y, x), name));
        rows.add(row);
      }
      return Expressions.bounded(rows);
    }
    throw ArcException.invalid(name + ": result requires workbook context");
  }

  private static Object excel(String name, List<Object> args) {
    try {
      if (name.equals("COMBIN")
          && Expressions.number(args.getFirst()).abs().compareTo(BigDecimal.valueOf(10000)) > 0)
        throw ArcException.invalid("COMBIN supports n up to 10,000");
      if (Set.of("FIXED", "DOLLAR", "TRUNC").contains(name)
          && args.size() > 1
          && Expressions.number(args.get(1)).abs().compareTo(BigDecimal.valueOf(100)) > 0)
        throw ArcException.invalid(name + ": decimal places must be -100 to 100");
      if (name.equals("REPT")
          && (Expressions.number(args.get(1)).signum() < 0
              || Expressions.number(args.get(1)).compareTo(BigDecimal.valueOf(2000)) > 0
              || String.valueOf(args.getFirst()).length()
                      * Expressions.number(args.get(1)).doubleValue()
                  > 2000)) throw ArcException.invalid("REPT result exceeds string limit");
      var m = FunctionMetadataRegistry.getFunctionByName(name);
      ValueEval result =
          FunctionEval.getBasicFunction(m.getIndex())
              .evaluate(args.stream().map(Functions::value).toArray(ValueEval[]::new), 0, 0);
      return converted(result, name);
    } catch (ArcException e) {
      throw e;
    } catch (RuntimeException e) {
      throw ArcException.invalid(name + ": invalid arguments or unsupported workbook context");
    }
  }

  private Functions() {}
}
