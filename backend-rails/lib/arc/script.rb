module Arc
  class Script
    ID = '("(?:[^"\\\\]|\\\\.)*"|[A-Za-z_][A-Za-z_0-9-]*)'
    HEADER = /\Anode\s+#{ID}\s+(INPUT|FORMULA|CONDITION|REFERENCE|OUTPUT)\s+("(?:[^"\\]|\\.)*")(?:\s+at\s*\(\s*(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\s*,\s*(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\s*\))?\z/i
    INPUT = /\A([A-Za-z_][A-Za-z_0-9]*)\s*:\s*(NUMBER|STRING|BOOLEAN|ARRAY|OBJECT)\s+(required|optional)(?:\s+default\s+(.+))?\z/im
    EDGE = /\A(next|true|false)\s*->\s*#{ID}(?:\s+edge\s+#{ID})?\z/i
    Statement = Struct.new(:text, :line, :column)
    class ScriptError < StandardError
      attr_reader :line, :column
      def initialize(message, line, column)
        super(message)
        @line, @column = line, column
      end
    end

    def initialize
      @validator = Validator.new
    end

    def build(source)
      d = parse(source)
      @validator.shape(d)
      { "definition" => d, "source" => render(d), "diagnostics" => [] }
    rescue ScriptError, ArcError => e
      failed(source, e)
    end

    def failed(source, error)
      { "definition" => nil, "source" => source, "diagnostics" => [{ "message" => error.message,
          "line" => error.is_a?(ScriptError) ? error.line : 1, "column" => error.is_a?(ScriptError) ? error.column : 1 }] }
    end

    def parse(source)
      raise ScriptError.new("Source must be at most 100,000 characters", 1, 1) if source.nil? || source.length > 100_000
      scanner, inputs, nodes, edges, sources = Scanner.new(source), [], [], [], {}
      input_block = false
      while scanner.more?
        header = scanner.scan(true)
        h = header.text
        if h.casecmp?("schema 1")
          scanner.expect(";")
          next
        end
        if h.casecmp?("inputs")
          error("Only one inputs block is allowed", header) if input_block
          input_block = true
          scanner.expect("{")
          scanner.body.each do |st|
            if st.text.start_with?("source ")
              m = /\Asource\s+(\w+)\s*=\s*(.+)\z/m.match(st.text)
              error("Use: source parameter = { JSON source binding };", st) unless m
              error("Duplicate input source", st) if sources.key?(m[1])
              sources[m[1]] = Definition.record(read(m[2], st), "id version bindings pointer onError", "version" => 0)
            else
              m = INPUT.match(st.text)
              error("Use: parameter: NUMBER|STRING|BOOLEAN|ARRAY|OBJECT required|optional [default JSON];", st) unless m
              inputs << { "name" => m[1], "type" => m[2].upcase, "required" => m[3].casecmp?("required"), "defaultValue" => m[4] ? read(m[4], st) : nil, "source" => nil }
            end
          end
          next
        end
        m = HEADER.match(h)
        error('Expected inputs { ... } or node id TYPE "Label" [at (x, y)] { ... }', header) unless m
        scanner.expect("{")
        id, type, label = unquote(m[1], header), m[2].upcase, unquote(m[3], header)
        position = m[4] ? { "x" => Float(m[4]), "y" => Float(m[5]) } : { "x" => (nodes.size % 3) * 300.0, "y" => (nodes.size / 3) * 170.0 }
        expression = output = rule_id = version = nil
        bindings, assigned = {}, Set.new
        scanner.body.each do |st|
          text = st.text
          if (edge = EDGE.match(text))
            handle, target = edge[1].downcase, unquote(edge[2], st)
            unique(assigned, "#{handle}:#{target}", st)
            edges << { "id" => edge[3] ? unquote(edge[3], st) : "#{id}-#{handle}-#{target}", "source" => id, "target" => target, "sourceHandle" => handle }
          elsif text.start_with?("let ") && type == "FORMULA"
            output, expression = assignment(text[4..], st)
            unique(assigned, "expression", st)
            check_expression(expression, st)
          elsif text.start_with?("when ") && type == "CONDITION"
            unique(assigned, "expression", st)
            expression = text[5..].strip
            check_expression(expression, st)
          elsif text.start_with?("return ") && type == "OUTPUT"
            unique(assigned, "expression", st)
            expression = text[7..].strip
            check_expression(expression, st)
          elsif text.start_with?("use ") && type == "REFERENCE"
            use = /\Ause\s+#{ID}\s+version\s+([1-9]\d*)\z/.match(text)
            error('Use: use "rule-id" version 1;', st) unless use
            unique(assigned, "use", st)
            rule_id, version = unquote(use[1], st), use[2].to_i
            error("Version is too large", st) if version > 2_147_483_647
          elsif text.start_with?("bind ") && type == "REFERENCE"
            name, expr = assignment(text[5..], st)
            unique(assigned, "bind:#{name}", st)
            check_expression(expr, st)
            bindings[name] = expr
          elsif text.start_with?("as ") && type == "REFERENCE"
            unique(assigned, "as", st)
            output = text[3..].strip
          else
            error("Unsupported statement for #{type}: #{text}", st)
          end
        end
        nodes << { "id" => id, "type" => type, "label" => label, "position" => position, "expression" => expression,
                   "output" => output, "ruleId" => rule_id, "version" => version, "bindings" => type == "REFERENCE" ? bindings : nil }
      end
      sources.each_key { |name| raise ScriptError.new("Source refers to unknown input: #{name}", 1, 1) unless inputs.any? { |p| p["name"] == name } }
      inputs.each { |p| p["source"] = sources[p["name"]] }
      { "schemaVersion" => 1, "inputs" => inputs, "nodes" => nodes, "edges" => edges, "notes" => scanner.notes }
    end

    def build_node(d, node_id, source)
      @validator.shape(d)
      original = d["nodes"].find { |n| n["id"] == node_id } || raise(ArcError.new(422, "Node not found"))
      fragment = parse(source)
      unless fragment["nodes"].size == 1 && fragment["nodes"][0]["id"] == node_id && fragment["nodes"][0]["type"] == original["type"]
        raise ArcError.new(422, "Keep exactly this node, with the same ID and type. Use Code studio to edit the whole graph.")
      end
      if original["type"] != "INPUT" && !fragment["inputs"].empty?
        raise ArcError.new(422, "Edit parameters in the Input node.")
      end
      merged = d.merge("inputs" => original["type"] == "INPUT" ? fragment["inputs"] : d["inputs"],
                       "nodes" => d["nodes"].map { |n| n["id"] == node_id ? fragment["nodes"][0] : n },
                       "edges" => d["edges"].reject { |e| e["source"] == node_id } + fragment["edges"])
      @validator.shape(merged)
      { "definition" => merged, "source" => render(merged, node_id), "diagnostics" => [] }
    rescue ScriptError, ArcError => e
      failed(source, e)
    end

    def render(d, node_id = nil)
      @validator.shape(d)
      raise ArcError.new(422, "Node not found") if node_id && d["nodes"].none? { |n| n["id"] == node_id }
      out = +"schema 1;\n\n"
      (d["notes"] || []).each { |note| note.split(/\r\n|[\n\r\u0085\u2028\u2029]/, -1).each { |line| out << "// #{line}\n" } } unless node_id
      if node_id.nil? || d["nodes"].any? { |n| n["id"] == node_id && n["type"] == "INPUT" }
        out << "inputs {\n"
        d["inputs"].each do |p|
          out << "  #{p['name']}: #{p['type']} #{p['required'] ? 'required' : 'optional'}"
          out << " default #{ArcJson.dump(p['defaultValue'])}" unless p["defaultValue"].nil?
          out << ";\n"
          out << "  source #{p['name']} = #{ArcJson.dump(p['source'])};\n" if p["source"]
        end
        out << "}\n"
      end
      d["nodes"].each do |n|
        next if node_id && n["id"] != node_id
        out << "\nnode #{ArcJson.dump(n['id'])} #{n['type']} #{ArcJson.dump(n['label'])}"
        out << " at (#{n['position']['x'].to_f}, #{n['position']['y'].to_f})" if n["position"]
        out << " {\n"
        case n["type"]
        when "FORMULA" then out << "  let #{n['output'] || 'result'} = #{n['expression'] || '0'};\n"
        when "CONDITION" then out << "  when #{n['expression'] || 'true'};\n"
        when "OUTPUT" then out << "  return #{n['expression'] || 'null'};\n"
        when "REFERENCE"
          out << "  use #{ArcJson.dump(n['ruleId'])} version #{n['version']};\n" if n["ruleId"] && n["version"]
          (n["bindings"] || {}).sort.each { |key, value| out << "  bind #{key} = #{value};\n" }
          out << "  as #{n['output'] || 'result'};\n"
        end
        d["edges"].select { |e| e["source"] == n["id"] }.each do |e|
          out << "  #{e['sourceHandle']} -> #{ArcJson.dump(e['target'])} edge #{ArcJson.dump(e['id'])};\n"
        end
        out << "}\n"
      end
      out
    end

    def check_expression(expression, st)
      Expressions.compile(expression)
    rescue ArcError => e
      error(e.message, st)
    end

    def unique(keys, key, st)
      error("Duplicate statement: #{key}", st) unless keys.add?(key)
    end

    def assignment(source, st)
      m = /\A([A-Za-z_][A-Za-z_0-9]*)\s*=\s*(.+)\z/m.match(source)
      error("Expected variable = expression", st) unless m
      [m[1], m[2].strip]
    end

    def read(source, st)
      ArcJson.load(source)
    rescue StandardError
      error("Invalid JSON literal or source binding", st)
    end

    def unquote(source, st)
      source.start_with?('"') ? read(source, st) : source
    end

    def error(message, st)
      raise ScriptError.new(message, st.line, st.column)
    end

    class Scanner
      attr_reader :notes
      def initialize(source)
        @source, @index, @line, @column, @notes = source, 0, 1, 1, []
      end

      def advance
        @source[@index] == "\n" ? (@line += 1; @column = 1) : @column += 1
        @index += 1
      end

      def whitespace
        while @index < @source.length
          if @source[@index].match?(/\s/)
            advance
          elsif @source[@index, 2] == "//"
            start = @index + 2
            advance while @index < @source.length && @source[@index] != "\n"
            @notes << @source[start...@index].strip
          else
            break
          end
        end
      end

      def more?
        whitespace
        @index < @source.length
      end

      def expect(char)
        whitespace
        raise ScriptError.new("Expected '#{char}'", @line, @column) unless @source[@index] == char
        advance
      end

      def body
        result = []
        while more? && @source[@index] != "}"
          result << scan(false)
          expect(";")
        end
        expect("}")
        result
      end

      def scan(header)
        whitespace
        start, line, column, nesting, quote, escape = @index, @line, @column, 0, nil, false
        while @index < @source.length
          char = @source[@index]
          if quote
            if escape then escape = false
            elsif char == "\\" then escape = true
            elsif char == quote then quote = nil
            end
            advance
            next
          end
          if ['"', "'"].include?(char)
            quote = char
            advance
            next
          end
          break if header && %w[{ ;].include?(char)
          break if !header && nesting.zero? && char == ";"
          raise ScriptError.new("Statement must end with ';'", @line, @column) if !header && nesting.zero? && char == "}"
          nesting += 1 if ["{", "[", "("].include?(char)
          nesting -= 1 if ["}", "]", ")"].include?(char)
          advance
        end
        raise ScriptError.new("Unfinished statement or quoted string", line, column) if quote || @index >= @source.length
        Statement.new(@source[start...@index].strip, line, column)
      end
    end
  end
end
