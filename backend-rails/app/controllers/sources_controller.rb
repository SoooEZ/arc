class SourcesController < ApplicationController
  def index
    respond(DataSource.order(updated_at: :desc).map { |s| DataSourceVersion.fetch(s.id, s.version).document })
  end

  def create
    id = body["id"]
    raise ArcError.new(422, "Invalid source ID") unless id.is_a?(String) && /\A[a-z][a-z0-9-]{0,79}\z/.match?(id)
    definition = ArcRuntime.call("sourceConfig", body)
    source = DataSource.transaction do
      DataSource.create!(id: id, name: body["name"])
      DataSourceVersion.create!(source_id: id, version: 1, definition: definition)
    end
    respond(source.document)
  end

  def update
    definition = ArcRuntime.call("sourceConfig", body)
    source = DataSource.transaction do
      current = DataSource.lock.find_by(id: params[:id]) || raise(ArcError.new(404, "Data source not found"))
      revision = integer(body["revision"], default: 0)
      raise ArcError.new(409, "Source changed in another editor; reload before saving") unless current.version == revision
      version = revision + 1
      created = DataSourceVersion.create!(source_id: current.id, version: version, definition: definition)
      current.update!(name: body["name"], version: version, updated_at: Time.current)
      created
    end
    respond(source.document)
  end

  def versions
    respond(DataSourceVersion.where(source_id: params[:id]).order(version: :desc).map(&:document))
  end

  def version
    respond(DataSourceVersion.fetch(params[:id], path_version).document)
  end

  def test_source
    version = integer(body["version"])
    version ||= DataSourceVersion.where(source_id: params[:id]).maximum(:version)
    raise ArcError.new(404, "Source not found") if version.nil?
    respond(ArcRuntime.call("fetchSource", { "id" => params[:id], "version" => version, "inputs" => body["inputs"] }))
  end
end
