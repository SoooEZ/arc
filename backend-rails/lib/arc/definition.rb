module Arc
  module Definition
    module_function
    def record(value, names, defaults = {})
      return nil if value.nil?
      raise TypeError unless value.is_a?(Hash)
      names.split.to_h { |name| [name, value.fetch(name, defaults[name])] }
    end

    def list(value)
      return nil if value.nil?
      raise TypeError unless value.is_a?(Array)
      value.map { |item| yield item }
    end

    def input(value)
      p = record(value, "name type required defaultValue source", "required" => false)
      return nil unless p
      p["source"] = record(p["source"], "id version bindings pointer onError", "version" => 0)
      p
    end

    def normalize(value)
      d = record(value, "schemaVersion inputs nodes edges notes", "schemaVersion" => 0)
      return nil unless d
      d["inputs"] = list(d["inputs"]) { |p| input(p) }
      d["nodes"] = list(d["nodes"]) do |value|
        n = record(value, "id type label position expression output ruleId version bindings")
        n["position"] = record(n["position"], "x y", "x" => 0, "y" => 0) if n
        n
      end
      d["edges"] = list(d["edges"]) { |e| record(e, "id source target sourceHandle") }
      d
    end

    def source(value)
      c = record(value, "kind url parameters entries secretHeaders timeoutMs", "timeoutMs" => 0)
      c["parameters"] = list(c["parameters"]) { |p| input(p) } if c
      c
    end
  end
end
