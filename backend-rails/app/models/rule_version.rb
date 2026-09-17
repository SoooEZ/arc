class RuleVersion < ApplicationRecord
  self.primary_key = [:rule_id, :version]
  self.record_timestamps = false
  attribute :definition, DecimalJsonType.new

  def document
    { ruleId: rule_id, version: version, definition: definition, publishedAt: published_at.utc.iso8601(6) }
  end

  def self.fetch(id, version)
    find_by(rule_id: id, version: version) ||
      raise(ArcError.new(404, "Published rule version not found: #{id} v#{version}"))
  end
end
