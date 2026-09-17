require "set"
require "bigdecimal"

module Arc
  module Expressions
    TOKEN = /\G\s*(?:(\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\.\d+)|([A-Za-z_][A-Za-z_0-9.]*)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(&&|\|\||==|!=|<>|<=|>=|[=^\[\]+*\/%<>()!,\-]))/
    PRIORITY = { "||" => 1, "OR" => 1, "&&" => 2, "AND" => 2, "==" => 3, "!=" => 3, "=" => 3, "<>" => 3,
                 "<" => 4, "<=" => 4, ">" => 4, ">=" => 4, "+" => 5, "-" => 5, "*" => 6, "/" => 6, "%" => 6, "^" => 8 }.freeze
    module_function

    def invalid(message)
      raise ArcError.new(422, message)
    end

    def compile(source)
      invalid("Expression is required") if source.nil? || source.strip.empty?
      invalid("Expression exceeds 2,000 characters") if source.length > 2000
      parser = Parser.new(source.strip)
      ast = parser.parse(0)
      invalid("Unexpected token: #{parser.peek}") unless parser.peek == "<end>"
      Compiled.new(ast, parser.variables)
    end

    def evaluate(source, scope)
      compile(source).evaluate(scope)
    end

    def type(value)
      case value
      when nil then "null"
      when String then "String"
      when true, false then "Boolean"
      when BigDecimal then "BigDecimal"
      when Integer then "Integer"
      when Float then "Double"
      when Array then "ArrayList"
      when Hash then "LinkedHashMap"
      else value.class.name
      end
    end

    def number(value)
      invalid("Expected a number, got #{type(value)}") unless value.is_a?(Numeric)
      bounded(value.is_a?(BigDecimal) ? value : BigDecimal(value.to_s))
    rescue ArgumentError
      invalid("Invalid numeric value")
    end

    def bool(value)
      invalid("Expected a boolean, got #{type(value)}") unless value == true || value == false
      value
    end

    def bounded(value, depth = 0, count = [0])
      count[0] += 1
      invalid("Value exceeds collection depth or size limit") if depth > 8 || count[0] > 10_000
      if value.is_a?(BigDecimal) && value.finite?
        digits = value.split[1].length
        invalid("Number exceeds supported precision or magnitude") if digits > 100 || (digits - value.exponent).abs > 100
      end
      invalid("Number must be finite") if value.is_a?(Numeric) && !value.to_f.finite?
      invalid("String exceeds 2,000 characters") if value.is_a?(String) && value.encode("UTF-16BE").bytesize > 4000
      if value.is_a?(Array)
        invalid("Array exceeds 1,000 items") if value.size > 1000
        value.each { |v| bounded(v, depth + 1, count) }
      elsif value.is_a?(Hash)
        invalid("Object exceeds 1,000 fields") if value.size > 1000
        value.each { |k, v| bounded(k, depth + 1, count); bounded(v, depth + 1, count) }
      end
      value
    end

    def equal(a, b)
      a.is_a?(Numeric) && b.is_a?(Numeric) ? number(a) == number(b) : a == b
    end

    def decimal(value)
      value.round(34 - value.exponent, BigDecimal::ROUND_HALF_EVEN)
    end

    def binary(op, a, b)
      return (%w[== =].include?(op)) == equal(a, b) if %w[== != = <>].include?(op)
      if %w[< <= > >=].include?(op)
        cmp = a.is_a?(String) && b.is_a?(String) ? a <=> b : number(a) <=> number(b)
        return { "<" => cmp < 0, "<=" => cmp <= 0, ">" => cmp > 0, ">=" => cmp >= 0 }.fetch(op)
      end
      x, y = number(a), number(b)
      invalid("Division by zero") if %w[/ %].include?(op) && y.zero?
      result = case op
      when "+" then x.add(y, 34)
      when "-" then x.sub(y, 34)
      when "*" then x.mult(y, 34)
      when "/" then x.div(y, 34)
      when "%" then decimal(x.remainder(y))
      when "^"
        invalid("Exponent must be an integer") unless y.frac.zero?
        invalid("Exponent must be -100 to 100") if y.abs > 100
        invalid("Invalid power") if x.zero? && y.negative?
        y.negative? ? BigDecimal("1").div(x.power(-y.to_i, 34), 34) : x.power(y.to_i, 34)
      else invalid("Unknown operator: #{op}")
      end
      bounded(result)
    end

    class Compiled
      attr_reader :variables
      def initialize(ast, variables)
        @ast, @variables = ast, variables.freeze
      end

      def evaluate(scope)
        BigDecimal.save_rounding_mode do
          BigDecimal.mode(BigDecimal::ROUND_MODE, BigDecimal::ROUND_HALF_EVEN)
          Expressions.bounded(Evaluation.new.run(@ast, scope))
        end
      end
    end

    class Evaluation
      def initialize
        @work = 0
      end

      def tick
        @work += 1
        Expressions.invalid("Expression exceeds 10,000 operations") if @work > 10_000
      end

      def run(ast, scope)
        kind, *args = ast
        case kind
        when :literal then args[0]
        when :variable
          root, path = args
          Expressions.invalid("Unknown variable: #{root}") unless scope.key?(root)
          path ? Functions.get(scope[root], path, nil) : scope[root]
        when :array then Expressions.bounded(args[0].map { |a| run(a, scope) })
        when :unary
          op, expr = args
          value = run(expr, scope)
          op == "!" ? !Expressions.bool(value) : op == "-" ? Expressions.decimal(-Expressions.number(value)) : Expressions.number(value)
        when :binary
          op, a, b = args
          return Expressions.bool(run(a, scope)) && Expressions.bool(run(b, scope)) if %w[&& AND].include?(op)
          return Expressions.bool(run(a, scope)) || Expressions.bool(run(b, scope)) if %w[|| OR].include?(op)
          Expressions.binary(op, run(a, scope), run(b, scope))
        when :function then function(args[0], args[1], scope)
        when :collection
          name, collection, local, accumulator, initial, body = args
          xs = Functions.array(run(collection, scope))
          total = initial && run(initial, scope)
          result = []
          xs.each do |item|
            tick
            child = scope.merge(local => item)
            child[accumulator] = total if accumulator
            value = run(body, child)
            case name
            when "MAP" then result << value
            when "FILTER" then result << item if Expressions.bool(value)
            when "ALL" then return false unless Expressions.bool(value)
            when "ANY" then return true if Expressions.bool(value)
            when "REDUCE" then total = value
            end
          end
          Expressions.bounded(name == "REDUCE" ? total : name == "ALL" ? true : name == "ANY" ? false : result)
        end
      end

      def function(name, args, scope)
        tick
        return run(args[Expressions.bool(run(args[0], scope)) ? 1 : 2], scope) if name == "IF"
        if %w[ISERROR ISERR ISNA].include?(name)
          begin
            run(args[0], scope)
            return false
          rescue ArcError => e
            na = e.message.include?("#N/A")
            return name == "ISERROR" || (name == "ISNA" && na) || (name == "ISERR" && !na)
          end
        end
        if name == "IFERROR"
          begin
            return run(args[0], scope)
          rescue ArcError
            return run(args[1], scope)
          end
        end
        return args.all? { |a| Expressions.bool(run(a, scope)) } if name == "AND"
        return args.any? { |a| Expressions.bool(run(a, scope)) } if name == "OR"
        if name == "SWITCH"
          value = run(args[0], scope)
          (1...args.size - 1).step(2) { |i| return run(args[i + 1], scope) if Expressions.equal(value, run(args[i], scope)) }
          return run(args[-1], scope) if args.size.even?
          Expressions.invalid("SWITCH has no matching case or default")
        end
        Expressions.bounded(Functions.call(name, args.map { |a| run(a, scope) }))
      end
    end

    class Parser
      attr_reader :variables
      def initialize(source)
        @tokens, @variables, @locals = [], Set.new, Set.new
        @index = @depth = 0
        position = 0
        while position < source.length
          match = TOKEN.match(source, position)
          Expressions.invalid("Invalid expression near character #{position + 1}") unless match
          @tokens << match[0].strip
          position = match.end(0)
          Expressions.invalid("Expression exceeds 256 tokens") if @tokens.size > 256
        end
        @tokens << "<end>"
      end

      def peek
        @tokens[@index] || "<end>"
      end

      def take
        value = peek
        @index += 1
        value
      end

      def expect(token)
        Expressions.invalid("Expected '#{token}', got '#{peek}'") unless peek == token
        take
      end

      def parse(min)
        @depth += 1
        Expressions.invalid("Expression nesting exceeds 48 levels") if @depth > 48
        left = atom
        while PRIORITY.fetch(peek, -1) >= min
          op = take
          left = [:binary, op, left, parse(PRIORITY.fetch(op) + (op == "^" ? 0 : 1))]
        end
        @depth -= 1
        left
      end

      def atom
        token = take
        Expressions.invalid("Incomplete expression") if token == "<end>"
        if token == "["
          values = arguments("]")
          return [:array, values]
        end
        if token == "("
          nested = parse(0)
          expect(")")
          return nested
        end
        return [:unary, token, parse(7)] if %w[! - +].include?(token)
        if token.start_with?('"', "'")
          return [:literal, token[1...-1].gsub(/\\(.)/m) { { "n" => "\n", "t" => "\t", "r" => "\r" }.fetch(Regexp.last_match(1), Regexp.last_match(1)) }]
        end
        return [:literal, Expressions.number(BigDecimal(token))] if /\A[\d.]/.match?(token)
        return [:literal, token.casecmp?("true")] if %w[true false].include?(token.downcase) && peek != "("
        return [:literal, nil] if token.casecmp?("null")
        Expressions.invalid("Unexpected token: #{token}") unless /\A[A-Za-z_][A-Za-z_0-9.]*\z/.match?(token)
        if peek == "("
          take
          name = token.upcase
          if %w[MAP FILTER ALL ANY REDUCE].include?(name)
            collection = parse(0)
            expect(",")
            local = take
            Expressions.invalid("Collection function needs a local item identifier") unless Validator.identifier?(local)
            expect(",")
            accumulator = initial = nil
            if name == "REDUCE"
              accumulator = take
              Expressions.invalid("REDUCE needs distinct item and accumulator identifiers") unless Validator.identifier?(accumulator) && accumulator != local
              expect(",")
              initial = parse(0)
              expect(",")
            end
            before = @locals.dup
            @locals << local
            @locals << accumulator if accumulator
            body = parse(0)
            @locals = before
            expect(")")
            return [:collection, name, collection, local, accumulator, initial, body]
          end
          args = arguments(")")
          Functions.arity(name, args.size)
          return [:function, name, args]
        end
        root, path = token.split(".", 2)
        @variables << root unless @locals.include?(root)
        [:variable, root, path]
      end

      def arguments(close)
        args = []
        unless peek == close
          args << parse(0)
          while peek == ","
            take
            args << parse(0)
          end
        end
        expect(close)
        args
      end
    end
  end
end
