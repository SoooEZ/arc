module Arc
  module Excel
    module_function
    def error(code = "#VALUE!")
      raise CalculationError, code
    end
    class CalculationError < StandardError; end

    def scalar(value)
      value.is_a?(Array) ? scalar(value.first) : value
    end

    def num(value)
      value = scalar(value)
      return 0.0 if value.nil? || value == false
      return 1.0 if value == true
      Float(value)
    rescue ArgumentError, TypeError
      error
    end

    def int(value)
      num(value).to_i
    end

    def str(value)
      value = scalar(value)
      return "TRUE" if value == true
      return "FALSE" if value == false
      Functions.text(value)
    end

    def boolean(value)
      value = scalar(value)
      return value if value == true || value == false
      return false if value.nil?
      return !value.zero? if value.is_a?(Numeric)
      return true if value.is_a?(String) && value.casecmp?("true")
      return false if value.is_a?(String) && value.casecmp?("false")
      error
    end

    def numbers(args, include_booleans: false, include_text: false)
      args.flat_map do |arg|
        if arg.is_a?(Array)
          arg.flatten.filter_map do |v|
            if v.is_a?(Numeric) then v.to_f
            elsif (v == true || v == false) && include_booleans then v ? 1.0 : 0.0
            elsif v.is_a?(String) && include_text then 0.0
            end
          end
        else
          arg.nil? ? [] : [num(arg)]
        end
      end
    end

    def matrix(value)
      return [[value]] unless value.is_a?(Array)
      return [[nil]] if value.empty?
      value.map { |row| row.is_a?(Array) ? row : [row] }
    end

    def range_check(value)
      if value.is_a?(Hash)
        raise ArcError.new(422, "Excel functions require scalars or rectangular arrays")
      elsif value.is_a?(Array)
        rows = matrix(value)
        width = rows.first.size
        raise ArcError.new(422, "Excel ranges cannot contain empty rows") if width.zero?
        rows.each do |row|
          raise ArcError.new(422, "Excel ranges must be rectangular") unless row.size == width
          raise ArcError.new(422, "Excel range cells must be scalars") if row.any? { |v| v.is_a?(Array) || v.is_a?(Hash) }
        end
      end
    end

    def call(name, args)
      args.each { |v| range_check(v) }
      result = evaluate(name, args)
      convert(result, name)
    rescue CalculationError => e
      raise ArcError.new(422, "#{name}: #{e.message}")
    rescue Math::DomainError, FloatDomainError, ZeroDivisionError
      raise ArcError.new(422, "#{name}: #NUM!")
    end

    def convert(value, name)
      raise ArcError.new(422, "#{name}: #NUM!") if value.is_a?(Complex)
      if value.is_a?(Numeric)
        raise ArcError.new(422, "#{name}: non-finite result") unless value.to_f.finite?
        BigDecimal(value.to_f.to_s)
      elsif value.is_a?(Array)
        Expressions.bounded(value.map { |v| convert(v, name) })
      else value
      end
    end

    def evaluate(name, a)
      x = a[0]
      case name
      when "TRUE" then true
      when "FALSE" then false
      when "NA" then error("#N/A")
      when "ISBLANK" then scalar(x).nil?
      when "ISLOGICAL" then [true, false].include?(scalar(x))
      when "ISNUMBER" then scalar(x).is_a?(Numeric)
      when "ISTEXT" then scalar(x).is_a?(String)
      when "ISNONTEXT" then !scalar(x).is_a?(String)
      when "ISREF" then x.is_a?(Array)
      when "ERROR.TYPE" then error("#N/A")
      when "PI" then Math::PI
      when "EXP", "LN", "LOG10", "SQRT", "SIN", "COS", "TAN", "ASIN", "ACOS", "ATAN", "SINH", "COSH", "TANH", "ASINH", "ACOSH", "ATANH"
        function = { "LN" => :log }.fetch(name, name.downcase.to_sym)
        Math.public_send(function, num(x))
      when "ATAN2" then error("#DIV/0!") if num(x).zero? && num(a[1]).zero?; Math.atan2(num(a[1]), num(x))
      when "LOG" then error("#NUM!") if num(x) <= 0 || num(a.fetch(1, 10)) <= 0; Math.log(num(x), num(a.fetch(1, 10)))
      when "DEGREES" then num(x) * 180 / Math::PI
      when "RADIANS" then num(x) * Math::PI / 180
      when "SIGN" then num(x) <=> 0
      when "INT" then num(x).floor
      when "POWER" then num(x)**num(a[1])
      when "MOD" then error("#DIV/0!") if num(a[1]).zero?; num(x) % num(a[1])
      when "CEILING"
        number, significance = num(x), num(a[1])
        error("#NUM!") if number * significance < 0
        significance.zero? ? 0 : (number / significance).ceil * significance
      when "EVEN", "ODD"
        number = num(x)
        rounded = number.abs.ceil
        rounded += 1 if rounded % 2 != (name == "EVEN" ? 0 : 1)
        number.negative? ? -rounded : rounded
      when "FACT"
        n = int(x); error("#NUM!") unless n.between?(0, 170)
        (1..n).reduce(1.0, :*)
      when "COMBIN"
        n, k = int(x), int(a[1])
        raise ArcError.new(422, "COMBIN supports n up to 10,000") if num(x).abs > 10_000
        error("#NUM!") if k < 0 || n < k || n < 0
        k = [k, n - k].min
        (1..k).reduce(1.0) { |v, i| v * (n - k + i) / i }
      when "TRUNC"
        places = a.size > 1 ? int(a[1]) : 0
        raise ArcError.new(422, "TRUNC: decimal places must be -100 to 100") if a.size > 1 && num(a[1]).abs > 100
        num(x).truncate(places)
      when "PRODUCT" then numbers(a).reduce(1.0, :*)
      when "SUMSQ" then numbers(a).sum { |n| n * n }
      when "SUMPRODUCT"
        arrays = a.map { |v| matrix(v).flatten }
        error if arrays.map(&:size).uniq.size != 1
        arrays.transpose.sum { |row| row.reduce(1.0) { |product, v| product * (v.is_a?(Numeric) ? v.to_f : 0) } }
      when "SUMX2MY2", "SUMX2PY2", "SUMXMY2"
        left, right = matrix(x).flatten, matrix(a[1]).flatten
        error("#N/A") if left.size != right.size
        left.zip(right).select { |v, w| v.is_a?(Numeric) && w.is_a?(Numeric) }.sum do |v, w|
          v, w = v.to_f, w.to_f
          name == "SUMXMY2" ? (v - w)**2 : name == "SUMX2MY2" ? v*v - w*w : v*v + w*w
        end
      when "SUBTOTAL"
        operation = { 1 => "AVERAGE", 2 => "COUNT", 3 => "COUNTA", 4 => "MAX", 5 => "MIN", 6 => "PRODUCT", 7 => "STDEV", 8 => "STDEVP", 9 => "SUM", 10 => "VAR", 11 => "VARP" }[int(x) % 100]
        error if operation.nil?
        return Functions.call(operation, a.drop(1)) if %w[AVERAGE COUNT MAX MIN SUM].include?(operation)
        evaluate(operation, a.drop(1))
      when "ROMAN" then roman(int(x), a.size > 1 ? int(a[1]) : 0)
      else
        return ExcelText.evaluate(name, a) if ExcelText::NAMES.include?(name)
        return ExcelDates.evaluate(name, a) if ExcelDates::NAMES.include?(name)
        return ExcelStatistics.evaluate(name, a) if ExcelStatistics::NAMES.include?(name)
        return ExcelFinance.evaluate(name, a) if ExcelFinance::NAMES.include?(name)
        return ExcelTables.evaluate(name, a) if ExcelTables::NAMES.include?(name)
        raise ArcError.new(422, "#{name}: invalid arguments or unsupported workbook context")
      end
    end

    def roman(n, form)
      error("#VALUE!") unless n.between?(0, 3999) && form.between?(0, 4)
      result = +""
      [[1000,"M"],[900,"CM"],[500,"D"],[400,"CD"],[100,"C"],[90,"XC"],[50,"L"],[40,"XL"],[10,"X"],[9,"IX"],[5,"V"],[4,"IV"],[1,"I"]].each do |value, symbol|
        count, n = n.divmod(value)
        result << symbol * count
      end
      # Simplification rules compatible with Apache POI Roman (see NOTICE).
      transformations = [
        [%w[XLV VL], %w[XCV VC], %w[CDL LD], %w[CML LM], %w[CMVC LMVL]],
        [%w[CDXC LDXL], %w[CDVC LDVL], %w[CMXC LMXL], %w[XCIX VCIV], %w[XLIX VLIV]],
        [%w[XLIX IL], %w[XCIX IC], %w[CDXC XD], %w[CDVC XDV], %w[CDIC XDIX], %w[LMVL XMV], %w[CMIC XMIX], %w[CMXC XM]],
        [%w[XDV VD], %w[XDIX VDIV], %w[XMV VM], %w[XMIX VMIV]],
        [%w[VDIV ID], %w[VMIV IM]]
      ]
      if form > 0
        transformations.each_with_index do |pairs, index|
          next if index > form || (index == 1 && form > 1)
          pairs.each { |from, to| result.gsub!(from, to) }
        end
      end
      result
    end
  end
end
