namespace :arc do
  desc "Apply the canonical SQL migrations and seed an empty database"
  task prepare: :environment do
    Arc::Migrator.run
    Rule.transaction do
      # Serialize seeders without creating a second migration history.
      ActiveRecord::Base.connection.execute("SELECT pg_advisory_xact_lock(1095910193)")
      if Rule.count.zero?
        ArcRuntime.call("samples").each do |sample|
          rule = Rule.create!(id: sample.fetch("id"), name: sample.fetch("name"), description: sample.fetch("description"),
                              kind: sample.fetch("kind"), draft: sample.fetch("definition"))
          ArcRuntime.call("validate", { "definition" => rule.draft })
          RuleVersion.create!(rule_id: rule.id, version: 1, definition: rule.draft)
          rule.update!(published_version: 1, revision: 2, updated_at: Time.current)
        end
        puts "Created ARC sample rules."
      end
    end
    puts "ARC database is ready."
  end
end
