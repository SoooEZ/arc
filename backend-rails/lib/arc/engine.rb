module Arc
  class Engine
    def initialize(resolver, sources)
      @resolver, @sources, @validator = resolver, sources, Validator.new
    end

    def execute(rule_id, version, definition, inputs)
      started = Process.clock_gettime(Process::CLOCK_MONOTONIC)
      @trace, @stack, @parameters = [], Set.new, Parameters.new(@sources)
      result = run(rule_id, version, definition, inputs, 0)
      { "ruleId" => rule_id, "version" => version, "result" => result, "trace" => @trace,
        "durationMicros" => ((Process.clock_gettime(Process::CLOCK_MONOTONIC) - started) * 1_000_000).to_i, "sources" => @parameters.reads }
    end

    def run(rule_id, version, d, inputs, depth)
      fail_rule("Rule nesting exceeds 16 levels") if depth > 16
      key = "#{rule_id}@#{version || 'null'}"
      fail_rule("Circular rule reference: #{key}") unless @stack.add?(key)
      begin
        @validator.validate(d, @resolver)
        plan = GraphPlan.new(d)
        input = plan.order.find { |n| n["type"] == "INPUT" }
        begin
          provided = @parameters.resolve(d["inputs"], inputs)
        rescue ArcError => e
          raise e.at_node(input, rule_id: rule_id, version: version)
        end
        scopes, branches, outputs = {}, {}, {}
        plan.order.each do |node|
          begin
            active = node["type"] == "INPUT"
            values = active ? provided.to_h { |k, v| [k, [v, input["id"]]] } : {}
            candidates = {}
            plan.incoming[node["id"]].each do |edge|
              next unless edge["sourceHandle"] == branches[edge["source"]]
              active = true
              scopes.fetch(edge["source"]).each { |name, value| (candidates[name] ||= {})[value[1]] = value }
            end
            next unless active
            candidates.each do |name, origins|
              latest = origins.values.reject { |v| origins.keys.any? { |other| plan.ancestors[other].include?(v[1]) } }
              fail_rule("Conflicting upstream values for '#{name}'; use distinct result variable names before merging") unless latest.size == 1
              values[name] = latest.first
            end
            fail_rule("Execution exceeds 1,000 steps") if @trace.size >= 1000
            scope = values.transform_values(&:first)
            branch = "next"
            value = case node["type"]
            when "INPUT" then scope.dup
            when "FORMULA" then Expressions.evaluate(node["expression"], scope)
            when "CONDITION"
              condition = Expressions.bool(Expressions.evaluate(node["expression"], scope))
              branch = condition.to_s
              condition
            when "REFERENCE"
              bound = (node["bindings"] || {}).transform_values { |expr| Expressions.evaluate(expr, scope) }
              run(node["ruleId"], node["version"], @resolver.call(node["ruleId"], node["version"]), bound, depth + 1)
            when "OUTPUT"
              branch = nil
              outputs[node["id"]] = Expressions.evaluate(node["expression"], scope)
            else fail_rule("Unknown node type")
            end
            values[node["output"]] = [value, node["id"]] if %w[FORMULA REFERENCE].include?(node["type"])
            scopes[node["id"]], branches[node["id"]] = values, branch
            fail_rule("Execution exceeds 1,000 steps") if @trace.size >= 1000
            @trace << { "ruleId" => rule_id, "version" => version, "nodeId" => node["id"], "label" => node["label"], "type" => node["type"], "value" => value, "branch" => branch, "depth" => depth }
          rescue ArcError => e
            raise e.at_node(node, rule_id: rule_id, version: version)
          end
        end
        fail_rule("Execution did not reach an Output node") if outputs.empty?
        outputs.size == 1 ? outputs.values.first : outputs
      rescue ArcError => e
        raise e.in_rule(rule_id, version)
      ensure
        @stack.delete(key)
      end
    end

    def fail_rule(message)
      raise ArcError.new(422, message)
    end
  end
end
