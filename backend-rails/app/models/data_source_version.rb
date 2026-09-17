class DataSourceVersion < ApplicationRecord
  self.primary_key = [:source_id, :version]
  self.record_timestamps = false
  attribute :definition, DecimalJsonType.new

  def document
    { id: source_id, name: DataSource.find(source_id).name, version: version, definition: definition }
  end

  def self.fetch(id, version)
    find_by(source_id: id, version: version) ||
      raise(ArcError.new(404, "Data source version not found: #{id} v#{version}"))
  end
end
