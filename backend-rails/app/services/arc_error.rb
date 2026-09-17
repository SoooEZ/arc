class ArcError < StandardError
  attr_reader :status, :issues, :locations
  def initialize(status, message, issues: [message], locations: [])
    super(message)
    @status, @issues, @locations = status, issues, locations
  end

  def at_node(node, rule_id: nil, version: nil)
    location = { "ruleId" => rule_id, "version" => version, "nodeId" => node["id"], "label" => node["label"] }
    ArcError.new(status, message, issues: issues, locations: ((locations || []) + [location]).uniq)
  end

  def in_rule(rule_id, version)
    mapped = (locations || []).map { |l| l["ruleId"].nil? ? l.merge("ruleId" => rule_id, "version" => version) : l }
    ArcError.new(status, message, issues: issues, locations: mapped)
  end

  def problem
    { "message" => message, "locations" => locations || [] }
  end

  def payload
    { status: status, message: message, issues: issues }.tap { |value| value[:locations] = locations unless locations.nil? }
  end
end
