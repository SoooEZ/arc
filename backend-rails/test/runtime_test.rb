require_relative "../config/environment"
require "minitest/autorun"

class RuntimeTest < Minitest::Test
  def expression(source, inputs = {})
    Arc::Expressions.evaluate(source, inputs)
  end

  def test_decimal_arithmetic_precedence_and_rounding
    assert_equal BigDecimal("0.3"), expression("0.1 + 0.2")
    assert_equal BigDecimal("512"), expression("2^3^2")
    assert_equal BigDecimal("-20"), expression("(2 + 3) * -4")
    assert_equal BigDecimal("20"), expression("ROUND(19.995, 2)")
    assert_equal BigDecimal("-1.24"), expression("ROUND(-1.235, 2)")
    assert_equal BigDecimal("0.3333333333333333333333333333333333"), expression("1/3")
    assert_equal BigDecimal("12345678901234567890.12345679"), expression("12345678901234567890.123456789 + 0.000000001")
  end

  def test_decimal_json_is_numeric_and_exact
    number = BigDecimal("12345678901234567890.123456789")
    wire = ArcJson.dump({ "amount" => number, "nil" => nil, "list" => [true, "你好 🌳"] })
    refute_match(/"amount":"/, wire)
    assert_equal number, ArcJson.load(wire).fetch("amount")
    assert_nil ArcJson.load(wire).fetch("nil")
  end

  def test_lazy_logic_and_nested_lexical_scopes
    assert_equal false, expression("false && 1/0 > 0")
    assert_equal true, expression("true || 1/0 > 0")
    assert_equal BigDecimal("42"), expression("IF(true,42,1/0)")
    assert_equal BigDecimal("42"), expression("SWITCH(2,1,1/0,2,42,0)")
    assert_equal true, expression("ISNA(NA())")
    scope = { "items" => [{ "price" => 10 }, { "price" => 25 }], "factor" => 2 }
    assert_equal BigDecimal("50"), expression("SUM(MAP(FILTER(items,item,item.price>10),item,item.price*factor))", scope)
    assert_equal Set["items", "factor"], Arc::Expressions.compile("MAP(items,item,item.price+factor)").variables
    assert_equal Set["items", "item"], Arc::Expressions.compile("MAP(items,item,item.price)+item").variables
    assert_equal BigDecimal("35"), expression("REDUCE(items,item,acc,0,acc+item.price)", scope)
  end

  def test_host_code_and_unbounded_values_are_rejected
    ["Runtime.getRuntime()", "new ProcessBuilder()", "T(java.lang.Runtime)", "system('whoami')", "Kernel.system('whoami')",
     "File.read('/etc/passwd')", "1e9999", "1 + " * 200 + "1", "(" * 60 + "1" + ")" * 60].each do |source|
      assert_raises(ArcError, source) { expression(source) }
    end
    error = assert_raises(ArcError) { expression("MAP(items,x,SUM(MAP(items,y,y)))", "items" => [1] * 101) }
    assert_includes error.message, "operations"
    assert_raises(ArcError) { expression('REPT("x", 1000000000)') }
    assert_raises(ArcError) { expression("COMBIN(1000000000,500000000)") }
    assert_raises(ArcError) { expression('"1" + 1') }
  end

  def test_graph_studio_round_trip_and_local_errors
    %w[RULE FORMULA DECISION_TREE].each do |kind|
      d = ArcRuntime.blank(kind)
      script = Arc::Script.new
      built = script.build(script.render(d))
      assert_empty built["diagnostics"]
      assert_equal d, built["definition"]
      result = Arc::Engine.new(->(*) { flunk "Unexpected reference" }, Arc::Sources.new).execute("test", 1, d, {})
      assert result.key?("result")
    end
    bad = Arc::Script.new.build("inputs { amount: NUMBER required; }\nnode bad FORMULA \"Oops\" {\n let x = 1 +;\n}")
    assert_nil bad["definition"]
    assert_equal 3, bad["diagnostics"][0]["line"]
  end

  def test_fan_out_and_conflicting_join_locations
    d = Arc::Definition.normalize({ "schemaVersion" => 1, "inputs" => [], "nodes" => [
      { "id" => "input", "type" => "INPUT", "label" => "Input" },
      { "id" => "left", "type" => "FORMULA", "label" => "Left", "expression" => "10", "output" => "amount" },
      { "id" => "right", "type" => "FORMULA", "label" => "Right", "expression" => "20", "output" => "amount" },
      { "id" => "output", "type" => "OUTPUT", "label" => "Output", "expression" => "amount" }
    ], "edges" => [["input","left"],["input","right"],["left","output"],["right","output"]].map { |from,to| { "id" => from + to, "source" => from, "target" => to, "sourceHandle" => "next" } } })
    error = assert_raises(ArcError) { Arc::Engine.new(->(*) {}, Arc::Sources.new).execute("test", 1, d, {}) }
    assert_includes error.message, "Conflicting upstream values"
    assert_equal "output", error.locations[0]["nodeId"]
    assert_equal "test", error.locations[0]["ruleId"]
  end

  def test_function_corpus_covers_every_enabled_function
    cases = ArcJson.load(File.read(File.join(Arc::Functions::DATA_PATH, "function-cases.json")))
    assert_equal Arc::Functions.catalog.select { |f| f["supported"] }.map { |f| f["name"] }.sort,
      cases.reject { |c| c["name"].start_with?("edge-") }.map { |c| c["name"] }.sort
    cases.each do |test_case|
      expected = test_case.fetch("expected")
      if expected["status"] == 200
        assert_value expected["value"], expression(test_case["expression"]), test_case["name"], test_case.fetch("absoluteTolerance", 1e-12).to_f
      else
        error = assert_raises(ArcError, test_case["name"]) { expression(test_case["expression"]) }
        assert_equal expected["status"], error.status, test_case["name"]
        # API validation prefixes the formula node label; direct evaluation has none.
        assert_equal expected["value"].delete_prefix("Result: "), error.message, test_case["name"]
      end
    end
  end

  def assert_value(expected, actual, label, absolute_tolerance = 1e-12)
    if expected.is_a?(Numeric)
      assert_kind_of Numeric, actual, label
      assert_in_delta expected.to_f, actual.to_f, [expected.to_f.abs * 1e-11, absolute_tolerance].max, label
    elsif expected.is_a?(Array)
      assert_kind_of Array, actual, label
      assert_equal expected.size, actual.size, label
      expected.zip(actual).each { |e, a| assert_value(e, a, label, absolute_tolerance) }
    elsif expected.nil?
      assert_nil actual, label
    else
      assert_equal expected, actual, label
    end
  end

  def test_chunked_body_is_bounded_before_parsing_and_errors_include_cors
    called = false
    boundary = ArcBoundary.new(->(_) { called = true; [200, {}, []] })
    status, headers, body = boundary.call({ "PATH_INFO" => "/api/rules", "REQUEST_METHOD" => "POST", "rack.input" => StringIO.new("x" * (ArcBoundary::LIMIT + 1)) })
    assert_equal 413, status
    assert_equal "*", headers["access-control-allow-origin"]
    assert_equal "Request body exceeds 1 MiB", ArcJson.load(body.join)["message"]
    refute called
  end

  def test_cors_preflight_never_calls_application
    boundary = ArcBoundary.new(->(_) { raise "should not route OPTIONS" })
    status, headers, body = boundary.call({ "PATH_INFO" => "/api/preview", "REQUEST_METHOD" => "OPTIONS" })
    assert_equal 200, status
    assert_includes headers["access-control-allow-methods"], "POST"
    assert_empty body
  end

  def test_migration_checksum_matches_flyway_line_ending_rules
    source = "CREATE TABLE example (id int);\n-- hello\n"
    expected = Zlib.crc32("CREATE TABLE example (id int);-- hello")
    expected -= 2**32 if expected >= 2**31
    assert_equal expected, Arc::Migrator.checksum(source)
    assert_equal expected, Arc::Migrator.checksum("\uFEFF" + source.gsub("\n", "\r\n"))
  end
end
