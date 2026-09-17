require "set"
module Arc
  class GraphPlan
    attr_reader :nodes, :incoming, :outgoing, :order, :ancestors, :available
    def initialize(definition)
      @nodes = definition.fetch("nodes").to_h { |n| [n.fetch("id"), n] }
      @incoming, @outgoing = Hash.new { |h, k| h[k] = [] }, Hash.new { |h, k| h[k] = [] }
      definition.fetch("edges").each { |e| @incoming[e["target"]] << e; @outgoing[e["source"]] << e }
      remaining = @nodes.to_h { |id, _| [id, @incoming[id].size] }
      ready = remaining.select { |_, count| count.zero? }.keys.sort
      @order, @ancestors, @available = [], {}, {}
      until ready.empty?
        id = ready.shift
        @order << @nodes[id]
        @ancestors[id] = @incoming[id].each_with_object(Set.new) { |e, set| set << e["source"]; set.merge(@ancestors.fetch(e["source"])) }
        @outgoing[id].each do |e|
          remaining[e["target"]] -= 1
          ready << e["target"] if remaining[e["target"]].zero?
        end
        ready.sort!
      end
      if @order.size != @nodes.size
        node = @nodes.values.find { |n| remaining[n["id"]] > 0 }
        raise ArcError.new(422, "Decision graphs cannot contain cycles").at_node(node)
      end
      availability(definition)
    end

    def availability(definition)
      logic, activation, predicates, scopes = Logic.new, {}, {}, {}
      @order.select { |n| n["type"] == "CONDITION" }.each_with_index { |n, i| predicates[n["id"]] = logic.make(i, 0, 1) }
      @order.each do |node|
        active = node["type"] == "INPUT" ? 1 : 0
        scope = node["type"] == "INPUT" ? definition["inputs"].to_h { |p| [p["name"], 1] } : {}
        @incoming[node["id"]].each do |edge|
          gate = activation.fetch(edge["source"])
          if edge["sourceHandle"] != "next" && predicates.key?(edge["source"])
            predicate = predicates[edge["source"]]
            gate = logic.apply(true, gate, edge["sourceHandle"] == "true" ? predicate : logic.invert(predicate))
          end
          active = logic.apply(false, active, gate)
          scopes.fetch(edge["source"]).each do |name, present|
            scope[name] = logic.apply(false, scope.fetch(name, 0), logic.apply(true, gate, present))
          end
        end
        @available[node["id"]] = active.zero? ? [] : scope.select { |_, present| logic.apply(true, active, logic.invert(present)).zero? }.keys.sort
        scope[node["output"]] = active if %w[FORMULA REFERENCE].include?(node["type"]) && node["output"]
        activation[node["id"]], scopes[node["id"]] = active, scope
      end
    end

    class Logic
      def initialize
        @branches, @unique, @cache, @inverse = [[2**31, 0, 0], [2**31, 1, 1]], {}, {}, { 0 => 1, 1 => 0 }
      end

      def make(variable, low, high)
        return low if low == high
        branch = [variable, low, high]
        return @unique[branch] if @unique.key?(branch)
        complex! if @branches.size >= 50_000
        @unique[branch] = @branches.size
        @branches << branch
        @unique[branch]
      end

      def invert(id)
        return @inverse[id] if @inverse.key?(id)
        variable, low, high = @branches[id]
        result = make(variable, invert(low), invert(high))
        @inverse[id], @inverse[result] = result, id
        result
      end

      def apply(conjunction, a, b)
        return a if a == b
        if conjunction
          return 0 if a.zero? || b.zero?
          return b if a == 1
          return a if b == 1
        else
          return 1 if a == 1 || b == 1
          return b if a.zero?
          return a if b.zero?
        end
        complex! if @cache.size > 200_000
        key = [conjunction, [a, b].min, [a, b].max]
        return @cache[key] if @cache.key?(key)
        x, y = @branches[a], @branches[b]
        top = [x[0], y[0]].min
        low = apply(conjunction, x[0] == top ? x[1] : a, y[0] == top ? y[1] : b)
        high = apply(conjunction, x[0] == top ? x[2] : a, y[0] == top ? y[2] : b)
        @cache[key] = make(top, low, high)
      end

      def complex!
        raise ArcError.new(422, "Branch analysis is too complex; split this graph into reusable rules")
      end
    end
  end
end
