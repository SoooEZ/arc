require "stringio"
require_relative "arc_json"

# Bound even chunked requests before Rails parses them, and keep API errors JSON.
class ArcBoundary
  LIMIT = 1_048_576
  CORS = { "access-control-allow-origin" => "*", "access-control-allow-methods" => "GET,POST,PUT,OPTIONS",
           "access-control-allow-headers" => "*" }.freeze

  def initialize(app)
    @app = app
  end

  def call(env)
    api = env["PATH_INFO"].start_with?("/api/")
    return [200, CORS.dup, []] if api && env["REQUEST_METHOD"] == "OPTIONS"
    if api && %w[POST PUT].include?(env["REQUEST_METHOD"])
      bytes = env["rack.input"].read(LIMIT + 1)
      return error(413, "Request body exceeds 1 MiB", api) if bytes.bytesize > LIMIT
      env["rack.input"] = StringIO.new(bytes)
    end
    status, headers, body = @app.call(env)
    headers.merge!(CORS) if api
    [status, headers, body]
  rescue ActionDispatch::Http::Parameters::ParseError, JSON::ParserError
    error(400, "Request contains malformed JSON or an invalid value", api)
  rescue StandardError => exception
    Rails.logger.error("ARC request failed: #{exception.class}")
    error(500, "An unexpected server error occurred", api)
  end

  private

  def error(status, message, api)
    headers = { "content-type" => "application/json" }
    headers.merge!(CORS) if api
    [status, headers, [ArcJson.dump({ status: status, message: message, issues: [] })]]
  end
end
