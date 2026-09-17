class HealthController < ApplicationController
  def show
    ActiveRecord::Base.connection.select_value("SELECT 1")
    ArcRuntime.call("health")
    respond({ "status" => "UP" })
  rescue StandardError
    respond({ "status" => "DOWN" }, status: 503)
  end

  def missing
    respond({ status: 404, message: "Not Found", issues: [] }, status: 404)
  end
end
