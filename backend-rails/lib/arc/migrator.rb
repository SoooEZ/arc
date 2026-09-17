require "zlib"
module Arc
  # Executes the canonical SQL and maintains the existing Flyway-compatible history.
  # The Rails image contains SQL files only; migration never invokes Java or Flyway.
  class Migrator
    def self.directory
      ENV.fetch("ARC_MIGRATIONS_PATH", File.expand_path("../../../database/migrations", __dir__))
    end

    def self.checksum(source)
      crc = Zlib.crc32(source.delete_prefix("\uFEFF").lines.map { |line| line.delete_suffix("\n").delete_suffix("\r") }.join)
      crc >= 2**31 ? crc - 2**32 : crc
    end

    def self.run
      files = Dir[File.join(directory, "V*__*.sql")].sort_by { |path| File.basename(path).split("__")[0].delete_prefix("V").split(/[._]/).map(&:to_i) }
      raise "No ARC SQL migrations found in #{directory}" if files.empty?
      connection = ActiveRecord::Base.connection
      connection.transaction do
        connection.execute("SELECT pg_advisory_xact_lock(1095910192)")
        connection.execute(<<~SQL)
          CREATE TABLE IF NOT EXISTS flyway_schema_history (
            installed_rank INTEGER NOT NULL PRIMARY KEY,
            version VARCHAR(50), description VARCHAR(200) NOT NULL,
            type VARCHAR(20) NOT NULL, script VARCHAR(1000) NOT NULL,
            checksum INTEGER, installed_by VARCHAR(100) NOT NULL,
            installed_on TIMESTAMP NOT NULL DEFAULT now(),
            execution_time INTEGER NOT NULL, success BOOLEAN NOT NULL
          )
        SQL
        connection.execute("CREATE INDEX IF NOT EXISTS flyway_schema_history_s_idx ON flyway_schema_history(success)")
        connection.execute("LOCK TABLE flyway_schema_history IN EXCLUSIVE MODE")
        history = connection.select_all("SELECT * FROM flyway_schema_history ORDER BY installed_rank").to_a
        files.each do |path|
          filename = File.basename(path)
          version, description = filename.delete_prefix("V").delete_suffix(".sql").split("__", 2)
          version = version.tr("_", ".")
          sql = File.read(path, encoding: "UTF-8")
          digest = checksum(sql)
          existing = history.find { |row| row["version"] == version }
          if existing
            raise "Migration #{version} is failed or its checksum changed; restore the original SQL file" unless existing["success"] && existing["checksum"] == digest
            next
          end
          start = Process.clock_gettime(Process::CLOCK_MONOTONIC)
          connection.execute(sql)
          rank = history.map { |row| row["installed_rank"] }.max.to_i + 1
          elapsed = ((Process.clock_gettime(Process::CLOCK_MONOTONIC) - start) * 1000).to_i
          quote = ->(value) { connection.quote(value) }
          connection.execute("INSERT INTO flyway_schema_history(installed_rank,version,description,type,script,checksum,installed_by,execution_time,success) VALUES (#{rank},#{quote.call(version)},#{quote.call(description.tr('_', ' '))},'SQL',#{quote.call(filename)},#{digest},current_user,#{elapsed},true)")
          history << { "installed_rank" => rank, "version" => version, "checksum" => digest, "success" => true }
          puts "Applied ARC migration #{version}: #{description}"
        end
      end
    end
  end
end
