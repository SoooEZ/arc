class ApplicationController < ActionController::API
  wrap_parameters false
  rescue_from ArcError, with: :arc_error
  rescue_from JSON::ParserError, TypeError, ArgumentError do
    arc_error(ArcError.new(400, "Request contains malformed JSON or an invalid value", issues: [], locations: nil))
  end
  rescue_from ActiveRecord::RecordNotUnique do
    arc_error(ArcError.new(409, "This rule ID already exists", issues: [], locations: nil))
  end

  private

  def body
    @body ||= begin
      value = ArcJson.load(request.raw_post)
      raise TypeError unless value.is_a?(Hash)
      value
    end
  end

  def integer(value, default: nil)
    return default if value.nil?
    raise TypeError unless value.is_a?(Integer) && value.between?(-2_147_483_648, 2_147_483_647)
    value
  end

  def path_version
    value = params[:version]
    raise ArgumentError unless /\A-?\d+\z/.match?(value)
    integer(Integer(value, 10))
  end

  def respond(value, status: 200)
    render body: ArcJson.dump(value), content_type: "application/json", status: status
  end

  def arc_error(error)
    respond(error.payload, status: error.status)
  end
end
