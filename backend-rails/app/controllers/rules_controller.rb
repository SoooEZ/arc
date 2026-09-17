class RulesController < ApplicationController
  def index
    respond(Rule.order(updated_at: :desc, id: :asc).map(&:document))
  end

  def show
    respond(Rule.fetch(params[:id]).document)
  end

  def create
    id = body["id"]
    unless id.is_a?(String) && /\A[a-z][a-z0-9-]{0,79}\z/.match?(id)
      raise ArcError.new(422, "Rule ID must start with a lowercase letter and contain only lowercase letters, digits, and hyphens (max 80)")
    end
    metadata!
    raise ArcError.new(422, "Choose DECISION_TREE, FORMULA, or RULE") unless %w[DECISION_TREE FORMULA RULE].include?(body["kind"])
    definition = body["definition"] || ArcRuntime.call("blank", { "kind" => body["kind"] })
    definition = ArcRuntime.call("shape", { "definition" => definition })
    rule = Rule.create!(id: id, name: body["name"].strip, description: body["description"] || "", kind: body["kind"], draft: definition)
    respond(rule.reload.document, status: 201)
  end

  def update
    rule = Rule.transaction do
      rule = Rule.fetch(params[:id], lock: true)
      revision!(rule)
      metadata!
      definition = ArcRuntime.call("shape", { "definition" => body["definition"] })
      rule.update!(name: body["name"].strip, description: body["description"] || "", draft: definition,
                   revision: rule.revision + 1, updated_at: Time.current)
      rule
    end
    respond(rule.document)
  end

  def publish
    rule = Rule.transaction do
      rule = Rule.fetch(params[:id], lock: true)
      revision!(rule)
      ArcRuntime.call("validate", { "definition" => rule.draft })
      version = (rule.published_version || 0) + 1
      RuleVersion.create!(rule_id: rule.id, version: version, definition: rule.draft)
      rule.update!(published_version: version, revision: rule.revision + 1, updated_at: Time.current)
      rule
    end
    respond(rule.document)
  end

  def versions
    Rule.fetch(params[:id])
    respond(RuleVersion.where(rule_id: params[:id]).order(version: :desc).map(&:document))
  end

  def version
    respond(RuleVersion.fetch(params[:id], path_version).document)
  end

  def execute
    rule = Rule.fetch(params[:id])
    version = integer(body["version"], default: rule.published_version)
    raise ArcError.new(409, "Publish this rule before calling its execution endpoint") if version.nil?
    definition = RuleVersion.fetch(rule.id, version).definition
    respond(ArcRuntime.call("execute", { "ruleId" => rule.id, "version" => version, "definition" => definition, "inputs" => body["inputs"] }))
  end

  private

  def metadata!
    name, description = body.values_at("name", "description")
    raise TypeError unless name.nil? || name.is_a?(String)
    raise TypeError unless description.nil? || description.is_a?(String)
    raise ArcError.new(422, "Name must contain 1 to 160 characters") if name.nil? || name.strip.empty? || name.length > 160
    raise ArcError.new(422, "Description exceeds 2,000 characters") if description && description.length > 2000
  end

  def revision!(rule)
    unless rule.revision == integer(body["revision"], default: 0)
      raise ArcError.new(409, "This rule changed in another editor. Reload it before saving or publishing.")
    end
  end
end
