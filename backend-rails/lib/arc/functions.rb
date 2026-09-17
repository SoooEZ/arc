require "date"
module Arc
  module Functions
    # Paths resolve relative to this checkout, never to a Java installation.
    DATA_PATH = ENV.fetch("ARC_CONTRACTS_PATH", File.expand_path("../../../contracts", __dir__))
    CATALOG = ArcJson.load(File.read(File.join(DATA_PATH, "functions.json"))).freeze
    ARITIES = ArcJson.load(File.read(File.join(DATA_PATH, "function-arities.json"))).freeze
    CUSTOM = %w[SUM MIN MAX AVG AVERAGE COUNT MUL ABS FLOOR CEIL ROUND ROUNDDOWN ROUNDUP NOT AND OR XOR CONTAINS CONCAT GET PLUCK].freeze
    module_function

    def catalog
      CATALOG
    end

    def arity(name, count)
      range = ARITIES[name]
      raise ArcError.new(422, "Unsupported function: #{name} (see function catalog)") unless range
      raise ArcError.new(422, "Invalid argument count for #{name}") unless count.between?(*range)
    end

    def array(value)
      raise ArcError.new(422, "Expected an array") unless value.is_a?(Array)
      value
    end

    def get(value, path, fallback = nil)
      path.split(".").each do |part|
        if value.is_a?(Hash) && value.key?(part)
          value = value[part]
        elsif value.is_a?(Array) && /\A\d{1,6}\z/.match?(part) && part.to_i < value.size
          value = value[part.to_i]
        else
          return fallback
        end
      end
      value
    end

    def text(value, null: "")
      return null if value.nil?
      return value.to_s("F").sub(/\.0\z/, "") if value.is_a?(BigDecimal)
      value.to_s
    end

    def call(name, args)
      return custom(name, args) if CUSTOM.include?(name)
      Excel.call(name, args)
    end

    def custom(name, args)
      if %w[SUM MIN MAX AVG AVERAGE COUNT MUL].include?(name)
        numbers = args.flatten.map { |v| Expressions.number(v) }
        return BigDecimal(numbers.size) if name == "COUNT"
        raise ArcError.new(422, "#{name} requires values") if numbers.empty? && !%w[SUM MUL].include?(name)
        case name
        when "MIN" then return numbers.min
        when "MAX" then return numbers.max
        when "MUL" then return numbers.reduce(BigDecimal("1")) { |a, b| a.mult(b, 34) }
        else
          total = numbers.reduce(BigDecimal("0")) { |a, b| a.add(b, 34) }
          return %w[AVG AVERAGE].include?(name) ? total.div(BigDecimal(numbers.size), 34) : total
        end
      end
      first = args[0]
      case name
      when "ABS" then Expressions.number(first).abs
      when "FLOOR" then Expressions.number(first).round(0, BigDecimal::ROUND_FLOOR)
      when "CEIL" then Expressions.number(first).round(0, BigDecimal::ROUND_CEILING)
      when "ROUND", "ROUNDDOWN", "ROUNDUP"
        digits = args.size > 1 ? Expressions.number(args[1]) : BigDecimal("0")
        raise ArcError.new(422, "Round precision must be an integer") unless digits.frac.zero?
        raise ArcError.new(422, "Round precision must be -12 to 12") if digits.abs > 12
        mode = { "ROUND" => BigDecimal::ROUND_HALF_UP, "ROUNDDOWN" => BigDecimal::ROUND_DOWN, "ROUNDUP" => BigDecimal::ROUND_UP }.fetch(name)
        Expressions.number(first).round(digits.to_i, mode)
      when "NOT" then !Expressions.bool(first)
      when "AND" then args.all? { |v| Expressions.bool(v) }
      when "OR" then args.any? { |v| Expressions.bool(v) }
      when "XOR" then args.count { |v| Expressions.bool(v) }.odd?
      when "CONTAINS" then first.is_a?(Array) ? first.any? { |v| Expressions.equal(v, args[1]) } : text(first, null: "null").include?(text(args[1], null: "null"))
      when "CONCAT" then args.flatten.map { |v| text(v) }.join
      when "GET" then get(first, text(args[1], null: "null"), args[2])
      when "PLUCK" then array(first).map { |v| get(v, text(args[1], null: "null"), args[2]) }
      end
    end
  end
end
