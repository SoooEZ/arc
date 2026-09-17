module Arc
  module ExcelText
    NAMES = %w[CHAR CLEAN CODE CONCATENATE DOLLAR EXACT FIND FIXED LEFT LEN LOWER MID PROPER REPLACE REPT RIGHT SEARCH SUBSTITUTE T TEXT TRIM UPPER VALUE].freeze
    extend Excel
    module_function
    def evaluate(name, a)
      text = Excel.str(a[0])
      case name
      when "CHAR" then n = Excel.int(a[0]); Excel.error unless n.between?(1, 255); n.chr(Encoding::UTF_8)
      when "CODE" then Excel.error if text.empty?; text.codepoints.first.to_s
      when "CLEAN" then text.gsub(/[\x00-\x1f]/, "")
      when "CONCATENATE" then a.map { |v| Excel.str(v) }.join
      when "EXACT" then text == Excel.str(a[1])
      when "LEFT", "RIGHT"
        count = a.size > 1 ? Excel.int(a[1]) : 1
        Excel.error if count.negative?
        name == "LEFT" ? text[0, count] : count.zero? ? "" : text[-[count, text.length].min, count].to_s
      when "MID"
        start, count = Excel.int(a[1]), Excel.int(a[2])
        Excel.error if start < 1 || count < 0
        text[start - 1, count].to_s
      when "LEN" then text.encode("UTF-16BE").bytesize / 2
      when "LOWER" then text.downcase
      when "UPPER" then text.upcase
      when "PROPER" then text.downcase.gsub(/[[:alpha:]]+/) { |word| word[0].upcase + word[1..] }
      when "TRIM" then text.gsub(/ +/, " ").sub(/\A /, "").sub(/ \z/, "")
      when "REPLACE"
        start, count, replacement = Excel.int(a[1]), Excel.int(a[2]), Excel.str(a[3])
        Excel.error if start < 1 || count < 0
        text[0, start - 1].to_s + replacement + text[(start - 1 + count)..].to_s
      when "REPT"
        count = Excel.num(a[1])
        raise ArcError.new(422, "REPT result exceeds string limit") if count < 0 || count > 2000 || text.length * count > 2000
        text * count.to_i
      when "FIND", "SEARCH"
        haystack, start = Excel.str(a[1]), a.size > 2 ? Excel.int(a[2]) : 1
        Excel.error if start < 1 || start > haystack.length + 1
        index = name == "SEARCH" ? haystack.index(wildcard(text, anchored: false), start - 1) : haystack.index(text, start - 1)
        Excel.error if index.nil?
        index + 1
      when "SUBSTITUTE"
        old, replacement = Excel.str(a[1]), Excel.str(a[2])
        return text if old.empty?
        return text.gsub(old) { replacement } if a.size == 3
        occurrence = Excel.int(a[3])
        Excel.error if occurrence < 1
        seen = 0
        text.gsub(old) { |match| seen += 1; seen == occurrence ? replacement : match }
      when "T" then Excel.scalar(a[0]).is_a?(String) ? Excel.scalar(a[0]) : ""
      when "VALUE"
        value(text)
      when "DOLLAR", "FIXED"
        places = a.size > 1 ? Excel.int(a[1]) : 2
        raise ArcError.new(422, "#{name}: decimal places must be -100 to 100") if places.abs > 100
        number = Excel.num(a[0])
        grouping = name == "DOLLAR" || a.size < 3 || !Excel.boolean(a[2])
        rendered = fixed(number.abs, places, grouping)
        if name == "DOLLAR"
          number.negative? ? "($#{rendered})" : "$#{rendered}"
        else
          (number.negative? ? "-" : "") + rendered
        end
      when "TEXT" then format_value(Excel.num(a[0]), Excel.str(a[1]))
      end
    end

    def value(text)
      value = text.strip
      negative = value.start_with?("(") && value.end_with?(")")
      value = value[1...-1] if negative
      percent = value.end_with?("%")
      value = value[0...-1] if percent
      value = value.delete(",").sub(/\A[$£€]\s*/, "")
      Excel.error unless /\A[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?\z/.match?(value)
      number = Float(value)
      number /= 100 if percent
      negative ? -number : number
    end

    def wildcard(pattern, anchored: true)
      parts, i = +"", 0
      while i < pattern.length
        char = pattern[i]
        if char == "~" && i + 1 < pattern.length
          i += 1
          parts << Regexp.escape(pattern[i])
        elsif char == "*" then parts << ".*"
        elsif char == "?" then parts << "."
        else parts << Regexp.escape(char)
        end
        i += 1
      end
      Regexp.new((anchored ? "\\A" : "") + parts + (anchored ? "\\z" : ""), Regexp::IGNORECASE | Regexp::MULTILINE)
    end

    def fixed(number, places, grouping)
      rounded = BigDecimal(number.to_s).round(places, BigDecimal::ROUND_HALF_UP)
      result = sprintf("%.#{[places, 0].max}f", rounded)
      whole, fraction = result.split(".", 2)
      whole = whole.reverse.scan(/.{1,3}/).join(",").reverse if grouping
      fraction ? whole + "." + fraction : whole
    end

    def format_value(number, format)
      sections = format.split(";")
      part = sections[number.negative? && sections.size > 1 ? 1 : number.zero? && sections.size > 2 ? 2 : 0]
      part = part.gsub(/\[(?:Red|Blue|Green|Yellow|Black|White|Color\d+)\]/i, "")
      return Functions.text(BigDecimal(number.to_s)) if part.casecmp?("general")
      if part.match?(/[ydhs]|m{2,}/i) && !part.match?(/E[+-]0/i)
        return ExcelDates.format_serial(number, part)
      end
      literals = []
      clean = part.gsub(/"([^"]*)"/) { literals << Regexp.last_match(1); "\x01#{literals.size - 1}\x02" }.gsub(/\\(.)/, '\1')
      if clean.match?(/[0#?]/)
        match = /[0#?,]+(?:\.[0#?]+)?(?:[eE][+-]0+)?/.match(clean)
        pattern = match[0]
        percent = clean.count("%")
        adjusted = number.abs * (100**percent)
        decimals = pattern.split(".", 2)[1].to_s.split(/[eE]/)[0].to_s.length
        rendered = if pattern.match?(/[eE]/)
          sprintf("%.#{decimals}E", adjusted)
        else
          fixed(adjusted, decimals, pattern.include?(","))
        end
        if pattern.include?(".")
          optional = pattern.split(".", 2)[1].to_s[/#+\z/].to_s.size
          optional.times { rendered = rendered.sub(/0\z/, "") }
          rendered = rendered.sub(/\.\z/, "")
        end
        min_integer = pattern.split(".")[0].count("0")
        rendered = rendered.rjust(min_integer, "0") if !rendered.include?(",") && !rendered.include?(".")
        clean = clean.sub(pattern, rendered)
        clean = "-" + clean if number.negative? && sections.size == 1
      end
      clean.gsub(/\x01(\d+)\x02/) { literals[Regexp.last_match(1).to_i] }.gsub(/_.|\*./, "")
    end
  end
end
