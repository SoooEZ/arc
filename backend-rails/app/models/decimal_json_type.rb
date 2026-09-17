class DecimalJsonType < ActiveRecord::ConnectionAdapters::PostgreSQL::OID::Jsonb
  def deserialize(value)
    value.is_a?(String) ? ArcJson.load(value) : value
  end

  def serialize(value)
    ArcJson.dump(value) unless value.nil?
  end
end
