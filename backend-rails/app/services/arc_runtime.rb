# Independent Ruby implementation of the shared ARC HTTP/graph contract.
# No subprocesses, Java runtime, host-language eval, or secondary HTTP service.
class ArcRuntime
  def self.call(operation, payload = {})
    validator, sources, script = Arc::Validator.new, Arc::Sources.new, Arc::Script.new
    cache = {}
    resolver = ->(id, version) { cache[[id, version]] ||= RuleVersion.fetch(id, version).definition }
    definition = Arc::Definition.normalize(payload["definition"]) if payload.key?("definition")
    validate = lambda do
      validator.validate(definition, resolver)
      sources.validate_bindings(definition, resolver)
    end
    case operation
    when "health" then { "status" => "UP" }
    when "functions" then Arc::Functions.catalog
    when "samples" then samples
    when "blank" then blank(payload["kind"])
    when "shape" then validator.shape(definition)
    when "variables" then validator.shape(definition); Arc::GraphPlan.new(definition).available
    when "validate" then validate.call; { "valid" => true }
    when "diagnostics"
      problems = validator.diagnostics(definition, resolver)
      begin
        validator.shape(definition)
        sources.validate_bindings(definition, resolver) if definition["nodes"].count { |n| n["type"] == "INPUT" } == 1
      rescue ArcError => error
        problems << error.problem unless (error.locations || []).empty?
      end
      problems.uniq
    when "execute"
      validate.call
      Arc::Engine.new(resolver, sources).execute(payload.fetch("ruleId", "preview"), payload["version"], definition, payload["inputs"])
    when "build" then script.build(payload["source"])
    when "render" then { "source" => script.render(definition) }
    when "buildNode" then script.build_node(definition, payload["nodeId"], payload["source"])
    when "renderNode" then { "source" => script.render(definition, payload["nodeId"]) }
    when "sourceConfig" then sources.validate(payload["name"], Arc::Definition.source(payload["definition"]))
    when "fetchSource" then { "result" => sources.fetch(payload["id"], payload["version"], payload["inputs"]) }
    else raise ArcError.new(400, "Unknown engine operation")
    end
  end

  def self.samples
    ArcJson.load(File.read(File.join(Arc::Functions::DATA_PATH, "samples.json")))
  end

  def self.blank(kind)
    return samples.find { |sample| sample["id"] == "free-shipping" }.fetch("definition") if kind == "RULE"
    Arc::Definition.normalize({ "schemaVersion" => 1, "notes" => [],
      "inputs" => [{ "name" => "amount", "type" => "NUMBER", "required" => true, "defaultValue" => 100 }],
      "nodes" => [
        { "id" => "input", "type" => "INPUT", "label" => "Inputs", "position" => { "x" => 280.0, "y" => 0.0 } },
        { "id" => "calculate", "type" => "FORMULA", "label" => "Calculate", "expression" => "amount * 0.9", "output" => "total", "position" => { "x" => 280.0, "y" => 160.0 } },
        { "id" => "result", "type" => "OUTPUT", "label" => "Return total", "expression" => "total", "position" => { "x" => 280.0, "y" => 320.0 } }
      ], "edges" => [
        { "id" => "input-next-calculate", "source" => "input", "target" => "calculate", "sourceHandle" => "next" },
        { "id" => "calculate-next-result", "source" => "calculate", "target" => "result", "sourceHandle" => "next" }
      ] })
  end
end
