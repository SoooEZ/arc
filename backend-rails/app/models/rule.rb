class Rule < ApplicationRecord
  self.record_timestamps = false
  attribute :draft, DecimalJsonType.new

  def document
    { id: id, name: name, description: description, kind: kind, draft: draft,
      revision: revision, publishedVersion: published_version,
      createdAt: created_at.utc.iso8601(6), updatedAt: updated_at.utc.iso8601(6) }
  end

  def self.fetch(id, lock: false)
    (lock ? self.lock : all).find_by(id: id) || raise(ArcError.new(404, "Rule not found: #{id}"))
  end
end
