module Arc
  module ExcelFinance
    NAMES = %w[FV IPMT IRR MIRR NPER NPV PMT PPMT PV RATE].freeze
    module_function
    def payment(rate, n, pv, fv = 0, type = 0)
      Excel.error("#DIV/0!") if n.zero?
      return -(pv + fv) / n if rate.zero?
      power = (1 + rate)**n
      -(pv * power + fv) * rate / ((1 + rate * type) * (power - 1))
    end

    def future(rate, n, pmt, pv = 0, type = 0)
      return -pv - pmt * n if rate.zero?
      power = (1 + rate)**n
      -pv * power - pmt * (1 + rate * type) * (power - 1) / rate
    end

    def evaluate(name, args)
      if name == "NPV"
        rate = Excel.num(args[0])
        Excel.error("#DIV/0!") if rate == -1
        return Excel.numbers(args.drop(1)).each_with_index.sum { |flow, i| flow / (1 + rate)**(i + 1) }
      end
      if %w[IRR MIRR].include?(name)
        values = Excel.numbers([args[0]])
        Excel.error("#NUM!") unless values.any?(&:positive?) && values.any?(&:negative?)
        if name == "MIRR"
          finance, reinvest = Excel.num(args[1]), Excel.num(args[2])
          Excel.error("#DIV/0!") if finance == -1 || reinvest == -1 || values.size < 2
          positive = values.each_with_index.sum { |v, i| v > 0 ? v * (1 + reinvest)**(values.size - 1 - i) : 0 }
          negative = values.each_with_index.sum { |v, i| v < 0 ? v / (1 + finance)**i : 0 }
          return (-positive / negative)**(1.0 / (values.size - 1)) - 1
        end
        guess = args.size > 1 ? Excel.num(args[1]) : 0.1
        return root(guess) { |rate| values.each_with_index.sum { |v, i| v / (1 + rate)**i } }
      end
      a = args.map { |v| Excel.num(v) }
      rate = a[0]
      case name
      when "PMT" then payment(rate, a[1], a[2], a.fetch(3, 0), a.fetch(4, 0))
      when "FV" then future(rate, a[1], a[2], a.fetch(3, 0), a.fetch(4, 0))
      when "PV"
        n, pmt, fv, type = a[1], a[2], a.fetch(3, 0), a.fetch(4, 0)
        rate.zero? ? -fv - pmt*n : -(fv + pmt*(1 + rate*type)*((1 + rate)**n - 1)/rate) / (1 + rate)**n
      when "NPER"
        pmt, pv, fv, type = a[1], a[2], a.fetch(3, 0), a.fetch(4, 0)
        return -(fv + pv) / pmt if rate.zero?
        ratio = (pmt * (1 + rate*type) - fv*rate) / (pv*rate + pmt*(1 + rate*type))
        Excel.error("#NUM!") if ratio <= 0 || rate <= -1
        Math.log(ratio) / Math.log(1 + rate)
      when "IPMT", "PPMT"
        per, n, pv, fv, type = a[1], a[2], a[3], a.fetch(4, 0), a.fetch(5, 0)
        Excel.error("#NUM!") unless per >= 1 && per <= n
        pmt = payment(rate, n, pv, fv, type)
        interest = type != 0 && per == 1 ? 0 : future(rate, per - 1, pmt, pv, type) * rate / (type == 0 ? 1 : 1 + rate)
        name == "IPMT" ? interest : pmt - interest
      when "RATE"
        n, pmt, pv, fv, type, guess = a[0], a[1], a[2], a.fetch(3, 0), a.fetch(4, 0), a.fetch(5, 0.1)
        legacy_rate(n, pmt, pv, fv, type, guess)
      end
    end

    # Preserve the RATE iteration used by existing Java-published rules.
    # Adapted from Apache POI's RATE / NumPy-derived convergence method; see NOTICE.
    def legacy_rate(periods, payment, present, future, timing, estimate)
      rate = estimate
      100.times do
        growth = (rate + 1)**periods
        prior = (rate + 1)**(periods - 1)
        scaled = payment * (growth - 1) * (rate * timing + 1)
        value = future + growth * present + scaled / rate
        slope = periods * prior * present - scaled / (rate**2 + periods * payment * prior * (rate * timing + 1) / rate + payment * (growth - 1) * timing / rate)
        next_rate = rate - value / slope
        return next_rate if (next_rate - rate).abs < 1e-8 && next_rate.finite?
        rate = next_rate
      end
      Excel.error("#NUM!")
    end

    def root(guess)
      value = guess
      100.times do
        Excel.error("#NUM!") if value <= -1 || !value.finite?
        f = yield(value)
        return value if f.abs < 1e-10
        step = [1e-7, value.abs * 1e-6].max
        derivative = ((yield(value + step)) - (yield(value - step))) / (2 * step)
        break if derivative.zero? || !derivative.finite?
        next_value = value - f / derivative
        return next_value if (next_value - value).abs <= 1e-12
        value = next_value
      end
      Excel.error("#NUM!")
    end
  end
end
