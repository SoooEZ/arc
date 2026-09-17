module Arc
  class Parameters
    attr_reader :reads
    def initialize(sources)
      @sources, @reads, @fetches = sources, [], 0
    end

    def resolve(parameters, supplied)
      raise ArcError.new(422, "inputs must be an object") unless supplied.is_a?(Hash)
      by_name = parameters.to_h { |p| [p["name"], p] }
      supplied.each_key { |name| raise ArcError.new(422, "Unknown input: #{name}") unless by_name.key?(name) }
      values = {}
      parameters.each { |p| resolve_one(p, by_name, supplied, values, Set.new) }
      values
    end

    def resolve_one(p, by_name, supplied, values, active)
      name = p["name"]
      return if values.key?(name)
      raise ArcError.new(422, "Circular source parameter dependency: #{name}") unless active.add?(name)
      value = p["defaultValue"]
      if supplied.key?(name)
        value = supplied[name]
      elsif (b = p["source"])
        start = Process.clock_gettime(Process::CLOCK_MONOTONIC)
        status, args = "RESOLVED", {}
        b["bindings"].each do |key, expression|
          expr = Expressions.compile(expression)
          expr.variables.each do |dependency|
            input = by_name[dependency] || raise(ArcError.new(422, "Unknown source dependency: #{dependency}"))
            resolve_one(input, by_name, supplied, values, active)
          end
          args[key] = expr.evaluate(values)
        end
        @fetches += 1
        raise ArcError.new(422, "Execution exceeds 50 source reads") if @fetches > 50
        begin
          value = @sources.extract(@sources.fetch(b["id"], b["version"], args), b["pointer"])
          raise ArcError.new(422, "Source returned null for required input") if value.nil? && p["required"]
          value = Validator.check_type(name, p["type"], value) unless value.nil?
        rescue ArcError => e
          if b["onError"] == "DEFAULT" && !p["defaultValue"].nil?
            value, status = p["defaultValue"], "DEFAULT"
          else
            raise ArcError.new(422, "#{name}: #{e.message}")
          end
        end
        @reads << { "input" => name, "sourceId" => b["id"], "version" => b["version"], "status" => status,
                    "durationMicros" => ((Process.clock_gettime(Process::CLOCK_MONOTONIC) - start) * 1_000_000).to_i }
      end
      raise ArcError.new(422, "Missing required input: #{name}") if value.nil? && p["required"]
      values[name] = value.nil? ? nil : Validator.check_type(name, p["type"], value)
      active.delete(name)
    end
  end
end
