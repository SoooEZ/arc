require_relative "boot"
require "rails"
require "active_record/railtie"
require "action_controller/railtie"
Bundler.require(*Rails.groups)
require_relative "../lib/arc_boundary"

module ArcRails
  class Application < Rails::Application
    config.load_defaults 8.1
    config.api_only = true
    config.middleware.insert_before 0, ArcBoundary
    config.eager_load = ENV["RAILS_ENV"] == "production"
    config.hosts.clear
    config.force_ssl = false
    config.secret_key_base = ENV.fetch("SECRET_KEY_BASE", "arc-stateless-api-no-cookie-or-session-middleware-" * 3)
    config.active_record.schema_format = :sql
    config.active_record.dump_schema_after_migration = false
    config.log_level = ENV.fetch("RAILS_LOG_LEVEL", "info")
    config.logger = ActiveSupport::Logger.new($stdout)
    config.action_dispatch.show_exceptions = :none
    config.autoload_lib(ignore: %w[tasks])
  end
end
