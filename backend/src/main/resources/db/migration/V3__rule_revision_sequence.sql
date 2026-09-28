-- Revisions come from one sequence instead of counting per rule, so a rule created again
-- under a deleted ID never repeats a revision that an open editor may still hold.
CREATE SEQUENCE rule_revisions;
SELECT setval('rule_revisions', COALESCE((SELECT MAX(revision) FROM rules), 0) + 1, false);
ALTER TABLE rules ALTER COLUMN revision SET DEFAULT nextval('rule_revisions');
