threads_count = Integer(ENV.fetch("RAILS_MAX_THREADS", "5"))
threads threads_count, threads_count
port ENV.fetch("PORT", 8080)
environment ENV.fetch("RAILS_ENV", "development")
require "fileutils"
pid_path = ENV.fetch("PIDFILE", File.expand_path("../tmp/pids/server.pid", __dir__))
FileUtils.mkdir_p(File.dirname(pid_path))
pidfile pid_path
