-- A publisher's short note on what a version changed. It is written once, with the version, and
-- versions published before this migration have none.
ALTER TABLE rule_versions ADD COLUMN note TEXT;
