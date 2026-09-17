require "bigdecimal"
require "json"
require "oj"

# Keep money and other decimal values numeric without passing through binary Float.
module ArcJson
  def self.load(value)
    JSON.parse(value, decimal_class: BigDecimal, max_nesting: 100)
  end

  def self.dump(value)
    Oj.dump(value, mode: :strict, bigdecimal_as_decimal: true)
  end
end
