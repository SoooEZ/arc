require "date"
module Arc
  module ExcelDates
    NAMES = %w[DATE DATEVALUE DAY DAYS360 HOUR MINUTE MONTH SECOND TIME TIMEVALUE WEEKDAY YEAR].freeze
    EPOCH = Date.new(1899, 12, 31)
    module_function
    def from_serial(value)
      n = Excel.num(value)
      Excel.error("#NUM!") if n < 0 || n > 2_958_465
      EPOCH + n.floor - (n >= 61 ? 1 : 0)
    end

    def serial(date)
      n = (date - EPOCH).to_i
      n += 1 if date >= Date.new(1900, 3, 1)
      n
    end

    def evaluate(name, a)
      case name
      when "DATE"
        year, month, day = a.map { |v| Excel.int(v) }
        year += 1900 if year.between?(0, 1899)
        Excel.error("#VALUE!") if year < 0 || year > 9999
        base = Date.new(year, 1, 1) >> (month - 1)
        return 60 if base.year == 1900 && base.month == 2 && day == 29
        serial(base + day - 1)
      when "DATEVALUE"
        text = Excel.str(a[0])
        # Explicit ARC/Excel formats avoid Ruby Date.parse's ambiguous short years.
        date_part = text.split(" ", 2).first.to_s
        separator = date_part.include?("/") ? "/" : "-"
        parts = date_part.split(separator, -1)
        year = Date.today.year
        if parts.size == 3 && /\A\d{4}\z/.match?(parts[0])
          year, month, day = parts
        elsif parts.size == 3 && /\A\d{4}\z/.match?(parts[2])
          year = parts[2]
          month, day = separator == "/" ? parts[0, 2] : [parts[1], parts[0]]
        elsif parts.size == 2
          month, day = parts
        else
          Excel.error
        end
        Excel.error unless /\A[A-Za-z0-9_]+\z/.match?(month) && /\A\d{1,2}\z/.match?(day)
        month = if /\A\d+\z/.match?(month)
          month.to_i
        else
          Date::MONTHNAMES.index { |name| name && name.downcase.start_with?(month.downcase) } || 0
        end
        date = Date.new(year.to_i, month, day.to_i)
        serial(date)
      when "DAY", "MONTH", "YEAR"
        value = Excel.num(a[0])
        return 0 if name == "DAY" && value.floor.zero?
        from_serial(value).public_send(name.downcase)
      when "WEEKDAY"
        n, type = Excel.num(a[0]), a.size > 1 ? Excel.int(a[1]) : 1
        Excel.error("#NUM!") if n < 0
        sunday = (n.floor + 6) % 7
        case type
        when 1 then sunday + 1
        when 2, 11 then (sunday + 6) % 7 + 1
        when 3 then (sunday + 6) % 7
        when 12..17 then (sunday - (type - 10)) % 7 + 1
        else Excel.error("#NUM!")
        end
      when "TIME"
        h, m, s = a.map { |v| Excel.int(v) }
        Excel.error("#VALUE!") if [h, m, s].any? { |v| v > 32767 }
        total = h * 3600 + m * 60 + s
        Excel.error("#VALUE!") if total < 0
        (total % 86400) / 86400.0
      when "TIMEVALUE"
        text = Excel.str(a[0])
        m = /(?:\A|\s)(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?\z/i.match(text)
        Excel.error if m.nil?
        h, minute, second = m[1].to_i, m[2].to_i, m[3].to_i
        h = h % 12 + (m[4].casecmp?("PM") ? 12 : 0) if m[4]
        Excel.error if h > 23 || minute > 59 || second > 59
        (h * 3600 + minute * 60 + second) / 86400.0
      when "HOUR", "MINUTE", "SECOND"
        n = Excel.num(a[0]); Excel.error("#NUM!") if n < 0
        seconds = ((n % 1) * 86400).round % 86400
        { "HOUR" => seconds / 3600, "MINUTE" => seconds / 60 % 60, "SECOND" => seconds % 60 }[name]
      when "DAYS360"
        start, finish = from_serial(a[0]), from_serial(a[1])
        european = a.size > 2 && Excel.boolean(a[2])
        d1, d2 = start.day, finish.day
        if european
          d1, d2 = [30, d1].min, [30, d2].min
        else
          d1 = 30 if d1 == (Date.new(start.year, start.month, -1)).day
          if d2 == 31
            if d1 < 30 then finish = finish + 1; d2 = 1
            else d2 = 30
            end
          end
        end
        (finish.year - start.year) * 360 + (finish.month - start.month) * 30 + d2 - d1
      end
    rescue Date::Error
      Excel.error
    end

    def format_serial(number, format)
      date = from_serial(number)
      seconds = ((number % 1) * 86400).round
      hour, minute, second = seconds / 3600 % 24, seconds / 60 % 60, seconds % 60
      am_pm = format.match?(/AM\/PM/i)
      tokens = /"[^"]*"|AM\/PM|yyyy|mmmm|dddd|mmm|ddd|yy|mm|dd|hh|ss|[ymdhs]|\\./i
      format.gsub(tokens) do |token|
        key = token.downcase
        if token.start_with?('"') then token[1...-1]
        elsif token.start_with?("\\") then token[1..]
        else
          minute_token = format.match?(/h.*m|m.*s/i)
          case key
          when "yyyy" then date.year.to_s.rjust(4, "0")
          when "yy" then (date.year % 100).to_s.rjust(2, "0")
          when "mmmm" then Date::MONTHNAMES[date.month]
          when "mmm" then Date::ABBR_MONTHNAMES[date.month]
          when "mm" then (minute_token ? minute : date.month).to_s.rjust(2, "0")
          when "m" then (minute_token ? minute : date.month).to_s
          when "dddd" then Date::DAYNAMES[date.wday]
          when "ddd" then Date::ABBR_DAYNAMES[date.wday]
          when "dd" then date.day.to_s.rjust(2, "0")
          when "d" then date.day.to_s
          when "hh", "h" then h = am_pm ? (hour % 12 == 0 ? 12 : hour % 12) : hour; key == "hh" ? h.to_s.rjust(2, "0") : h.to_s
          when "ss" then second.to_s.rjust(2, "0")
          when "s" then second.to_s
          when "am/pm" then hour >= 12 ? "PM" : "AM"
          else token
          end
        end
      end
    end
  end
end
