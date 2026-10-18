-- Saved test cases: inputs to run against a rule and the outcome they should produce. They are kept
-- beside the rule rather than in its draft, so writing one never changes the draft, its revision or
-- a published version. A case expects either a result (expected_result, where the JSON null
-- expects a null result) or a failure whose message contains expected_error, never both. Deleting
-- the rule deletes its cases.
CREATE TABLE rule_test_cases (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    rule_id VARCHAR(80) NOT NULL REFERENCES rules(id) ON DELETE CASCADE,
    name VARCHAR(160) NOT NULL,
    inputs JSONB NOT NULL,
    expected_result JSONB,
    expected_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK ((expected_result IS NULL) <> (expected_error IS NULL))
);

CREATE INDEX rule_test_cases_rule ON rule_test_cases (rule_id, id);
