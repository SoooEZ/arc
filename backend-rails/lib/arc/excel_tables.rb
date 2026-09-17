require "matrix"
module Arc
  module ExcelTables
    NAMES = %w[ADDRESS AREAS CHOOSE COLUMNS DAVERAGE DCOUNT DCOUNTA DGET DMAX DMIN DPRODUCT DSTDEV DSTDEVP DSUM DVAR DVARP HLOOKUP INDEX LOOKUP MATCH MDETERM MINVERSE MMULT ROWS TRANSPOSE TREND VLOOKUP].freeze
    module_function
    def evaluate(name, a)
      case name
      when "AREAS" then a[0].is_a?(Array) ? 1 : Excel.error("#VALUE!")
      when "ADDRESS"
        row, col = Excel.int(a[0]), Excel.int(a[1])
        mode, a1 = a.size > 2 ? Excel.int(a[2]) : 1, a.size <= 3 || Excel.boolean(a[3])
        Excel.error unless row > 0 && col > 0 && mode.between?(1, 4)
        abs_row, abs_col = [1, 2].include?(mode), [1, 3].include?(mode)
        if a1
          letters, n = +"", col
          while n > 0
            n, digit = (n - 1).divmod(26)
            letters.prepend((65 + digit).chr)
          end
          result = (abs_col ? "$" : "") + letters + (abs_row ? "$" : "") + row.to_s
        else
          result = "R#{abs_row ? row.to_s : '[' + row.to_s + ']'}C#{abs_col ? col.to_s : '[' + col.to_s + ']'}"
        end
        if a.size > 4
          sheet = Excel.str(a[4])
          sheet = "'#{sheet.gsub("'", "''")}'" unless /\A[A-Za-z_][A-Za-z_0-9.]*\z/.match?(sheet)
          result = sheet + "!" + result
        end
        result
      when "CHOOSE"
        index = Excel.int(a[0]); Excel.error unless index.between?(1, a.size - 1)
        area_result(a[index])
      when "COLUMNS" then Excel.matrix(a[0]).first.size
      when "ROWS" then Excel.matrix(a[0]).size
      when "TRANSPOSE" then area_result(Excel.matrix(a[0]).transpose)
      when "INDEX"
        table = Excel.matrix(a[0])
        row, col = Excel.int(a[1]), a.size > 2 ? Excel.int(a[2]) : 1
        if a.size == 2 && table.size == 1
          col, row = row, 1
        end
        Excel.error("#VALUE!") if row < 0 || col < 0
        Excel.error("#REF!") if row > table.size || col > table.first.size
        return area_result(table) if row.zero? && col.zero?
        return area_result(table.map { |r| [r[col - 1]] }) if row.zero?
        return area_result([table[row - 1]]) if col.zero?
        table[row - 1][col - 1]
      when "MATCH"
        values = Excel.matrix(a[1]).flatten
        match_type = a.size > 2 ? Excel.num(a[2]) : 1
        index = lookup_index(Excel.scalar(a[0]), values, match_type)
        index + 1
      when "VLOOKUP", "HLOOKUP"
        table = Excel.matrix(a[1])
        table = table.transpose if name == "HLOOKUP"
        index = Excel.int(a[2]); Excel.error("#VALUE!") if index < 1
        Excel.error("#REF!") if index > table.first.size
        row = lookup_index(Excel.scalar(a[0]), table.map(&:first), a.size > 3 && !Excel.boolean(a[3]) ? 0 : 1)
        table[row][index - 1]
      when "LOOKUP"
        table = Excel.matrix(a[1])
        if a.size > 2
          values, result = table.flatten, Excel.matrix(a[2]).flatten
        elsif table.first.size > table.size
          values, result = table.first, table.last
        else
          values, result = table.map(&:first), table.map(&:last)
        end
        index = lookup_index(Excel.scalar(a[0]), values, 1)
        Excel.error("#N/A") if index >= result.size
        result[index]
      when "MDETERM", "MINVERSE", "MMULT", "TREND" then matrix_function(name, a)
      else database(name, a)
      end
    end

    def area_result(value)
      return value unless value.is_a?(Array)
      table = Excel.matrix(value)
      table.size == 1 && table[0].size == 1 ? table[0][0] : table
    end

    def comparison(a, b)
      if a.is_a?(Numeric) && b.is_a?(Numeric) then a <=> b
      elsif a.is_a?(String) && b.is_a?(String) then a.downcase <=> b.downcase
      elsif [true, false].include?(a) && [true, false].include?(b) then (a ? 1 : 0) <=> (b ? 1 : 0)
      end
    end

    def lookup_index(key, values, type)
      index = nil
      values.each_with_index do |value, i|
        cmp = comparison(value, key)
        if type.zero?
          same = key.is_a?(String) && value.is_a?(String) ? ExcelText.wildcard(key).match?(value) : cmp == 0
          return i if same
        elsif cmp && (type > 0 ? cmp <= 0 : cmp >= 0)
          index = i
        end
      end
      Excel.error("#N/A") if index.nil?
      index
    end

    def matrix_function(name, a)
      if name == "TREND"
        ys_matrix = Excel.matrix(a[0])
        ys = ys_matrix.flatten.map { |v| Excel.num(v) }
        xs = a.size > 1 ? Excel.matrix(a[1]) : (1..ys.size).map { |n| [n.to_f] }
        xs = xs.transpose if xs.size == 1 && ys.size > 1
        Excel.error("#REF!") unless xs.size == ys.size
        constant = a.size < 4 || Excel.boolean(a[3])
        design = Matrix.rows(xs.map { |row| (constant ? [1.0] : []) + row.map { |v| Excel.num(v) } })
        y = Matrix.column_vector(ys)
        coef = (design.transpose * design).inverse * design.transpose * y
        next_x = a.size > 2 ? Excel.matrix(a[2]) : xs
        next_x = next_x.transpose if next_x.size == 1 && xs.first.size == 1 && next_x.first.size > 1
        result = next_x.map do |row|
          values = (constant ? [1.0] : []) + row.map { |v| Excel.num(v) }
          Excel.error("#REF!") unless values.size == coef.row_count
          [values.each_with_index.sum { |v, i| v * coef[i, 0] }]
        end
        return area_result(ys_matrix.size == 1 ? result.transpose : result)
      end
      matrices = a.map do |value|
        rows = Excel.matrix(value)
        Excel.error if rows.flatten.any? { |v| !v.is_a?(Numeric) }
        Matrix.rows(rows.map { |row| row.map(&:to_f) })
      end
      case name
      when "MDETERM" then Excel.error unless matrices[0].square?; matrices[0].determinant
      when "MINVERSE" then Excel.error unless matrices[0].square?; area_result(matrices[0].inverse.to_a)
      when "MMULT" then Excel.error unless matrices[0].column_count == matrices[1].row_count; area_result((matrices[0] * matrices[1]).to_a)
      end
    rescue ExceptionForMatrix::ErrNotRegular
      Excel.error("#NUM!")
    end

    def database(name, a)
      table, criteria = Excel.matrix(a[0]), Excel.matrix(a[2])
      headers = table.first.map { |v| Excel.str(v) }
      field = Excel.scalar(a[1])
      column = field.is_a?(Numeric) ? field.to_i - 1 : headers.index { |h| h.casecmp?(Excel.str(field)) }
      Excel.error unless column && column.between?(0, headers.size - 1)
      condition_columns = criteria.first.map { |v| headers.index { |h| h.casecmp?(Excel.str(v)) } }
      Excel.error if condition_columns.any?(&:nil?)
      selected = table.drop(1).select do |row|
        criteria.drop(1).any? do |conditions|
          conditions.each_with_index.all? { |condition, i| condition.nil? || condition == "" || ExcelStatistics.criterion(row[condition_columns[i]], condition) }
        end
      end.map { |row| row[column] }
      if name == "DGET"
        Excel.error("#VALUE!") if selected.empty?
        Excel.error("#NUM!") if selected.size > 1
        return selected[0]
      end
      return selected.count { |v| !v.nil? } if name == "DCOUNTA"
      values = selected.select { |v| v.is_a?(Numeric) }.map(&:to_f)
      case name
      when "DCOUNT" then values.size
      when "DSUM" then values.sum
      when "DPRODUCT" then values.reduce(1.0, :*)
      when "DMIN" then values.min || 0
      when "DMAX" then values.max || 0
      when "DAVERAGE" then Excel.error("#DIV/0!") if values.empty?; values.sum / values.size
      when "DSTDEV", "DSTDEVP", "DVAR", "DVARP"
        ExcelStatistics.evaluate({ "DSTDEV" => "STDEV", "DSTDEVP" => "STDEVP", "DVAR" => "VAR", "DVARP" => "VARP" }.fetch(name), [values])
      end
    end
  end
end
