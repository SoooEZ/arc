require "set"
module Arc
  class Validator
    TYPES = %w[INPUT FORMULA CONDITION REFERENCE OUTPUT].freeze
    def self.identifier?(value)
      value.is_a?(String) && /\A[A-Za-z_][A-Za-z_0-9]{0,63}\z/.match?(value) && !%w[true false null and or].include?(value.downcase)
    end

    def check(condition, message, node = nil)
      return if condition
      error = ArcError.new(422, message)
      raise(node ? error.at_node(node) : error)
    end

    def shape(d)
      check(d, "Definition is required")
      check(d["schemaVersion"] == 1, "Only schemaVersion 1 is supported")
      check(d["inputs"].is_a?(Array) && d["inputs"].size <= 50, "Provide at most 50 inputs")
      check(d["nodes"].is_a?(Array) && d["nodes"].size.between?(1, 100), "Provide 1 to 100 nodes")
      check(d["edges"].is_a?(Array) && d["edges"].size <= 200, "Provide at most 200 edges")
      check(d["notes"].nil? || (d["notes"].is_a?(Array) && d["notes"].size <= 500 && d["notes"].all? { |n| n.is_a?(String) && n.length <= 2000 }), "Too many or oversized comments")
      ids = Set.new
      d["nodes"].each do |n|
        begin
          check(n && n["id"].is_a?(String) && /\A[A-Za-z0-9_-]{1,80}\z/.match?(n["id"]), "Every node needs a valid ID")
          p = n["position"]
          check(p.nil? || %w[x y].all? { |k| p[k].is_a?(Numeric) && p[k].to_f.finite? && p[k].abs <= 1_000_000 }, "Node position must be finite and within canvas bounds")
          check(ids.add?(n["id"]), "Duplicate node ID: #{n['id']}")
          check(TYPES.include?(n["type"]), "Unknown node type: #{n['type'] || 'null'}")
          check(n["label"].is_a?(String) && !n["label"].strip.empty? && n["label"].length <= 160, "Every node needs a label of 1 to 160 characters")
          check(n["expression"].nil? || (n["expression"].is_a?(String) && n["expression"].length <= 2000), "Expression exceeds 2,000 characters")
          check(n["bindings"].nil? || (n["bindings"].is_a?(Hash) && n["bindings"].size <= 50), "Provide at most 50 parameter bindings")
          (n["bindings"] || {}).each { |k, v| check(self.class.identifier?(k) && v.is_a?(String) && v.length <= 2000, "Invalid parameter binding") }
        rescue ArcError => e
          raise(n ? e.at_node(n) : e)
        end
      end
      edge_ids = Set.new
      d["edges"].each do |e|
        check(e && e["id"].is_a?(String) && e["id"].length <= 100 && edge_ids.add?(e["id"]), "Every connection needs a unique ID")
        check(ids.include?(e["source"]) && ids.include?(e["target"]), "Connection refers to a missing node")
        check(%w[next true false].include?(e["sourceHandle"]), "Invalid connection handle")
      end
      names = Set.new
      d["inputs"].each do |p|
        check(p && self.class.identifier?(p["name"]), "Input names must be identifiers (letters, digits, underscores)")
        check(names.add?(p["name"]), "Duplicate input: #{p['name']}")
        check(%w[NUMBER STRING BOOLEAN ARRAY OBJECT].include?(p["type"]), "Unknown input type")
        self.class.check_type(p["name"], p["type"], p["defaultValue"]) unless p["defaultValue"].nil?
        next unless (b = p["source"])
        check(b["id"].is_a?(String) && /\A[a-z][a-z0-9-]{0,79}\z/.match?(b["id"]) && b["version"].is_a?(Integer) && b["version"] > 0, "Source needs an ID and version")
        check(b["bindings"].is_a?(Hash) && b["bindings"].size <= 20, "Source needs up to 20 mappings")
        b["bindings"].each { |k, v| check(self.class.identifier?(k) && v.is_a?(String) && v.length <= 2000, "Invalid source mapping") }
        check(b["pointer"].nil? || (b["pointer"].is_a?(String) && (b["pointer"].empty? || b["pointer"].start_with?("/") && b["pointer"].length <= 500)), "Use a JSON pointer starting with /")
        check(%w[FAIL DEFAULT].include?(b["onError"]), "Choose FAIL or DEFAULT source error policy")
        check(b["onError"] != "DEFAULT" || !p["defaultValue"].nil?, "Source fallback requires a default value")
      end
      d
    end

    def validate(d, resolver)
      validate_graph(d, resolver)
    rescue ArcError => e
      input = d && d["nodes"]&.find { |n| n && n["type"] == "INPUT" }
      raise((e.locations || []).empty? && input ? e.at_node(input) : e)
    end

    def validate_graph(d, resolver)
      shape(d)
      names = d["inputs"].map { |p| p["name"] }.to_set
      dependencies = d["inputs"].to_h do |p|
        deps = Set.new
        (p.dig("source", "bindings") || {}).each_value do |expr|
          expression(expr, names, p["name"] + " source")
          deps.merge(Expressions.compile(expr).variables)
        end
        [p["name"], deps]
      end
      names.each { |name| cycles(name, dependencies, Set.new, Set.new) }
      starts = d["nodes"].select { |n| n["type"] == "INPUT" }
      check(starts.size == 1, "A rule must have exactly one Input node")
      incoming = d["edges"].group_by { |e| e["target"] }
      outgoing = d["edges"].group_by { |e| e["source"] }
      check(incoming.fetch(starts[0]["id"], []).empty?, "Input node cannot have incoming connections")
      d["nodes"].each do |n|
        handles = outgoing.fetch(n["id"], []).map { |e| e["sourceHandle"] }.to_set
        expected = n["type"] == "CONDITION" ? %w[false true] : n["type"] == "OUTPUT" ? [] : ["next"]
        check(handles == expected.to_set, "#{n['label']}: connect #{expected.empty? ? 'no outgoing branches' : '[' + expected.join(', ') + ']'}", n)
      end
      connections = Set.new
      d["edges"].each do |e|
        check(connections.add?([e["source"], e["sourceHandle"], e["target"]]), "Duplicate connection", d["nodes"].find { |n| n["id"] == e["source"] })
      end
      plan = GraphPlan.new(d)
      visited, pending = Set.new, [starts[0]["id"]]
      until pending.empty?
        id = pending.pop
        next unless visited.add?(id)
        pending.concat(outgoing.fetch(id, []).map { |e| e["target"] })
      end
      d["nodes"].each { |n| check(visited.include?(n["id"]), "Every node must be reachable from Input; connect or remove unused nodes", n) }
      plan.order.each { |n| validate_node(d, n, plan.available[n["id"]], resolver) }
      d
    end

    def validate_node(d, n, scope, resolver)
      expression(n["expression"], scope, n["label"]) if %w[FORMULA CONDITION OUTPUT].include?(n["type"])
      if n["type"] == "REFERENCE"
        check(n["ruleId"] && n["version"].is_a?(Integer) && n["version"] > 0, "#{n['label']}: select a published rule and version")
        child = resolver.call(n["ruleId"], n["version"])
        bindings = n["bindings"] || {}
        child_names = child["inputs"].map { |p| p["name"] }
        child["inputs"].each { |p| check(!p["required"] || !p["defaultValue"].nil? || p["source"] || bindings.key?(p["name"]), "#{n['label']}: missing binding for #{p['name']}") }
        bindings.each do |key, expr|
          check(child_names.include?(key), "#{n['label']}: unknown parameter #{key}")
          expression(expr, scope, "#{n['label']} / #{key}")
        end
      end
      if %w[FORMULA REFERENCE].include?(n["type"])
        check(self.class.identifier?(n["output"]), "#{n['label']}: provide a valid result variable")
        check(d["inputs"].none? { |p| p["name"] == n["output"] }, "#{n['label']}: cannot overwrite input #{n['output']}")
      end
    rescue ArcError => e
      raise e.at_node(n)
    end

    def expression(expr, scope, label)
      unknown = Expressions.compile(expr).variables - scope.to_set
      check(unknown.empty?, "Variables unavailable on every incoming path: #{unknown.to_a.sort.join(', ')}")
    rescue ArcError => e
      raise ArcError.new(422, "#{label}: #{e.message}")
    end

    def cycles(name, deps, seen, active)
      check(!active.include?(name), "Circular source parameter dependency: #{name}")
      return unless seen.add?(name)
      active << name
      deps.fetch(name, []).each { |child| cycles(child, deps, seen, active) }
      active.delete(name)
    end

    def diagnostics(d, resolver)
      problems = []
      begin
        shape(d)
      rescue ArcError
        begin
          validate(d, resolver)
        rescue ArcError => e
          problems << e.problem
        end
        return problems
      end
      scope = nil
      begin
        scope = GraphPlan.new(d).available
      rescue ArcError => e
        problems << e.problem
      end
      d["nodes"].each do |n|
        begin
          if scope
            validate_node(d, n, scope.fetch(n["id"], []), resolver)
          else
            Expressions.compile(n["expression"]) if %w[FORMULA CONDITION OUTPUT].include?(n["type"])
            (n["bindings"] || {}).each_value { |expr| Expressions.compile(expr) }
          end
        rescue ArcError => e
          problems << e.at_node(n).problem
        end
      end
      input = d["nodes"].find { |n| n["type"] == "INPUT" }
      names = d["inputs"].map { |p| p["name"] }
      d["inputs"].each do |p|
        (p.dig("source", "bindings") || {}).each do |k, value|
          begin
            expression(value, names, "#{p['name']} source / #{k}")
          rescue ArcError => e
            problems << (input ? e.at_node(input) : e).problem
          end
        end
      end
      begin
        validate(d, resolver)
      rescue ArcError => e
        problems << e.problem
      end
      problems.uniq
    end

    def self.check_type(name, type, value)
      valid = case type
      when "NUMBER" then value.is_a?(Numeric)
      when "STRING" then value.is_a?(String)
      when "BOOLEAN" then value == true || value == false
      when "ARRAY" then value.is_a?(Array)
      when "OBJECT" then value.is_a?(Hash)
      else false
      end
      raise ArcError.new(422, "Input '#{name}' must be #{type.downcase}") unless valid
      value.is_a?(Numeric) ? Expressions.number(value) : Expressions.bounded(value)
    end
  end
end
