module Arc
  module ExcelStatistics
    NAMES = %w[AVEDEV AVERAGEA CORREL COUNTA COUNTBLANK COUNTIF COVAR DEVSQ FORECAST FREQUENCY GEOMEAN INTERCEPT LARGE MAXA MEDIAN MINA MODE NORMDIST NORMINV NORMSDIST NORMSINV PEARSON PERCENTILE PERCENTRANK POISSON RANK SLOPE SMALL STANDARDIZE STDEV STDEVA STDEVP STDEVPA SUMIF TDIST VAR VARA VARP VARPA].freeze
    module_function
    def evaluate(name, a)
      case name
      when "COUNTA" then a.flatten.count { |v| !v.nil? }
      when "COUNTBLANK" then Excel.matrix(a[0]).flatten.count { |v| v.nil? || v == "" }
      when "COUNTIF", "SUMIF"
        range = Excel.matrix(a[0]).flatten
        matches = range.each_index.select { |i| criterion(range[i], Excel.scalar(a[1])) }
        if name == "COUNTIF" then matches.size
        else
          sum_range = a.size > 2 ? Excel.matrix(a[2]).flatten : range
          matches.sum { |i| sum_range[i].is_a?(Numeric) ? sum_range[i].to_f : 0.0 }
        end
      when "CORREL", "COVAR", "PEARSON", "SLOPE", "INTERCEPT", "FORECAST"
        y_arg, x_arg = name == "FORECAST" ? a[1, 2] : a[0, 2]
        ys, xs = Excel.matrix(y_arg).flatten, Excel.matrix(x_arg).flatten
        Excel.error("#N/A") unless ys.size == xs.size
        pairs = ys.zip(xs).select { |y, x| y.is_a?(Numeric) && x.is_a?(Numeric) }.map { |y, x| [y.to_f, x.to_f] }
        Excel.error("#DIV/0!") if pairs.empty?
        ys, xs = pairs.transpose
        my, mx = ys.sum / ys.size, xs.sum / xs.size
        cross = pairs.sum { |y, x| (y - my) * (x - mx) }
        vx, vy = xs.sum { |x| (x - mx)**2 }, ys.sum { |y| (y - my)**2 }
        return cross / pairs.size if name == "COVAR"
        Excel.error("#DIV/0!") if vx.zero? || (%w[CORREL PEARSON].include?(name) && vy.zero?)
        slope = cross / vx
        return slope if name == "SLOPE"
        return my - slope * mx if name == "INTERCEPT"
        return my + slope * (Excel.num(a[0]) - mx) if name == "FORECAST"
        cross / Math.sqrt(vx * vy)
      when "FREQUENCY"
        data, bins = Excel.numbers([a[0]]), Excel.numbers([a[1]])
        counts = Array.new(bins.size + 1, 0)
        data.each { |v| counts[bins.index { |limit| v <= limit } || bins.size] += 1 }
        counts.map { |n| [n] }
      when "LARGE", "SMALL"
        values, k = Excel.numbers([a[0]]).sort, Excel.num(a[1]).ceil
        Excel.error("#NUM!") unless k.between?(1, values.size)
        values[name == "SMALL" ? k - 1 : -k]
      when "PERCENTILE"
        values, k = Excel.numbers([a[0]]).sort, Excel.num(a[1])
        Excel.error("#NUM!") if values.empty? || k < 0 || k > 1
        index = (values.size - 1) * k
        values[index.floor] + (values[index.ceil] - values[index.floor]) * (index % 1)
      when "PERCENTRANK"
        values, x, digits = Excel.numbers([a[0]]).sort, Excel.num(a[1]), a.size > 2 ? Excel.int(a[2]) : 3
        Excel.error("#NUM!") if digits < 1 || values.empty?
        Excel.error("#N/A") if x < values.first || x > values.last
        return 0 if values.size == 1
        upper = values.index { |v| v >= x }
        rank = values[upper] == x ? upper.to_f : upper - 1 + (x - values[upper - 1]) / (values[upper] - values[upper - 1])
        (rank / (values.size - 1)).truncate([digits, 15].min)
      when "RANK"
        number, values = Excel.num(a[0]), Excel.numbers([a[1]])
        Excel.error("#N/A") unless values.include?(number)
        ascending = a.size > 2 && Excel.num(a[2]) != 0
        1 + values.count { |v| ascending ? v < number : v > number }
      when "STANDARDIZE"
        sd = Excel.num(a[2]); Excel.error("#NUM!") if sd <= 0
        (Excel.num(a[0]) - Excel.num(a[1])) / sd
      when "NORMSDIST" then normal_cdf(Excel.num(a[0]))
      when "NORMSINV" then normal_inv(Excel.num(a[0]))
      when "NORMINV"
        sd = Excel.num(a[2]); Excel.error("#NUM!") if sd <= 0
        Excel.num(a[1]) + sd * normal_inv(Excel.num(a[0]))
      when "NORMDIST"
        sd = Excel.num(a[2]); Excel.error("#NUM!") if sd <= 0
        z = (Excel.num(a[0]) - Excel.num(a[1])) / sd
        Excel.boolean(a[3]) ? normal_cdf(z) : Math.exp(-z*z/2) / (sd * Math.sqrt(2 * Math::PI))
      when "POISSON"
        x, mean = Excel.int(a[0]), Excel.num(a[1])
        Excel.error("#NUM!") if x < 0 || mean <= 0
        Excel.boolean(a[2]) ? gamma_q(x + 1.0, mean) : Math.exp(-mean + x * Math.log(mean) - Math.lgamma(x + 1)[0])
      when "TDIST"
        x, df, tails = Excel.num(a[0]), Excel.int(a[1]), Excel.int(a[2])
        Excel.error("#NUM!") if x < 0 || df < 1 || ![1, 2].include?(tails)
        0.5 * tails * beta_regularized(df / (df + x*x), df / 2.0, 0.5)
      else
        include_a = %w[AVERAGEA MAXA MINA STDEVA STDEVPA VARA VARPA].include?(name)
        values = Excel.numbers(a, include_booleans: include_a, include_text: include_a)
        return values.empty? ? 0 : values.max if name == "MAXA"
        return values.empty? ? 0 : values.min if name == "MINA"
        Excel.error("#DIV/0!") if values.empty?
        mean = values.sum / values.size
        case name
        when "AVERAGEA" then mean
        when "AVEDEV" then values.sum { |v| (v - mean).abs } / values.size
        when "DEVSQ" then values.sum { |v| (v - mean)**2 }
        when "GEOMEAN"
          Excel.error("#NUM!") if values.any? { |v| v <= 0 }
          Math.exp(values.sum { |v| Math.log(v) } / values.size)
        when "MEDIAN"
          sorted = values.sort; n = sorted.size
          n.odd? ? sorted[n / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2.0
        when "MODE"
          counts = values.tally
          max = counts.values.max
          Excel.error("#N/A") if max < 2
          counts.select { |_, count| count == max }.keys.min
        when "STDEV", "STDEVA", "STDEVP", "STDEVPA", "VAR", "VARA", "VARP", "VARPA"
          population = %w[STDEVP STDEVPA VARP VARPA].include?(name)
          divisor = values.size - (population ? 0 : 1)
          Excel.error("#DIV/0!") if divisor.zero?
          variance = values.sum { |v| (v - mean)**2 } / divisor
          name.start_with?("STDEV") ? Math.sqrt(variance) : variance
        end
      end
    end

    def criterion(value, condition)
      return value.is_a?(Numeric) && value == condition if condition.is_a?(Numeric)
      return value == condition if condition == true || condition == false
      condition = "0" if condition.nil?
      text = condition.to_s
      match = /\A(<=|>=|<>|=|<|>)?(.*)\z/m.match(text)
      operator, operand = match[1] || "=", match[2]
      if /\A[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?\z/.match?(operand)
        unless value.is_a?(Numeric)
          return operator == "<>" && !value.nil?
        end
        cmp = value.to_f <=> operand.to_f
      else
        rendered = value.nil? ? "" : Excel.str(value)
        if ["=", "<>"].include?(operator)
          same = ExcelText.wildcard(operand).match?(rendered)
          return operator == "=" ? same : !same
        end
        cmp = rendered.downcase <=> operand.downcase
      end
      { "=" => cmp.zero?, "<>" => !cmp.zero?, "<" => cmp < 0, "<=" => cmp <= 0, ">" => cmp > 0, ">=" => cmp >= 0 }.fetch(operator)
    end

    def normal_cdf(x)
      0.5 * Math.erfc(-x / Math.sqrt(2.0))
    end

    def normal_inv(p)
      Excel.error("#NUM!") unless p > 0 && p < 1
      low, high = -40.0, 40.0
      100.times do
        mid = (low + high) / 2
        normal_cdf(mid) < p ? low = mid : high = mid
      end
      (low + high) / 2
    end

    def gamma_q(a, x)
      if x < a + 1
        term, sum = 1.0 / a, 1.0 / a
        10_000.times do |i|
          term *= x / (a + i + 1)
          sum += term
          break if term.abs < sum.abs * 1e-15
        end
        1 - sum * Math.exp(-x + a * Math.log(x) - Math.lgamma(a)[0])
      else
        b, c, d = x + 1 - a, 1e300, 1.0 / (x + 1 - a)
        h = d
        (1..10_000).each do |i|
          an = -i * (i - a)
          b += 2
          d = an * d + b; d = 1e-300 if d.abs < 1e-300
          c = b + an / c; c = 1e-300 if c.abs < 1e-300
          d = 1.0 / d
          delta = d * c
          h *= delta
          break if (delta - 1).abs < 1e-15
        end
        Math.exp(-x + a * Math.log(x) - Math.lgamma(a)[0]) * h
      end
    end

    def beta_regularized(x, a, b)
      return 0.0 if x <= 0
      return 1.0 if x >= 1
      bt = Math.exp(Math.lgamma(a + b)[0] - Math.lgamma(a)[0] - Math.lgamma(b)[0] + a * Math.log(x) + b * Math.log(1 - x))
      x < (a + 1) / (a + b + 2) ? bt * beta_fraction(x, a, b) / a : 1 - bt * beta_fraction(1 - x, b, a) / b
    end

    def beta_fraction(x, a, b)
      qab, qap, qam = a + b, a + 1, a - 1
      c, d = 1.0, 1 - qab * x / qap
      d = 1e-300 if d.abs < 1e-300
      d = 1.0 / d
      h = d
      (1..1000).each do |m|
        [m * (b - m) * x / ((qam + 2*m) * (a + 2*m)), -(a + m) * (qab + m) * x / ((a + 2*m) * (qap + 2*m))].each do |aa|
          d = 1 + aa*d; d = 1e-300 if d.abs < 1e-300
          c = 1 + aa/c; c = 1e-300 if c.abs < 1e-300
          d = 1.0 / d
          h *= d*c
        end
        break if (d*c - 1).abs < 1e-14
      end
      h
    end
  end
end
