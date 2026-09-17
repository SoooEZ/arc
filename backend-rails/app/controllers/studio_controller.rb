class StudioController < ApplicationController
  def preview
    respond(ArcRuntime.call("execute", { "ruleId" => "preview", "version" => nil, "definition" => body["definition"], "inputs" => body["inputs"] }))
  end

  def validate_graph
    respond(ArcRuntime.call("validate", { "definition" => body }))
  end

  def variables
    respond(ArcRuntime.call("variables", { "definition" => body }))
  end

  def diagnostics
    respond(ArcRuntime.call("diagnostics", { "definition" => body }))
  end

  def functions
    respond(ArcRuntime.call("functions"))
  end

  def build
    respond(ArcRuntime.call("build", body))
  end

  def render_graph
    respond(ArcRuntime.call("render", { "definition" => body }))
  end

  def build_node
    respond(ArcRuntime.call("buildNode", body))
  end

  def render_node
    respond(ArcRuntime.call("renderNode", body))
  end
end
