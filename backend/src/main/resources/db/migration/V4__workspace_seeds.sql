-- Records one-time seeding, so deleting every rule does not bring the sample rules back.
CREATE TABLE workspace_seeds (
    name VARCHAR(40) PRIMARY KEY,
    seeded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- A workspace that already holds rules was seeded before this table existed.
INSERT INTO workspace_seeds (name) SELECT 'rule-samples' WHERE EXISTS (SELECT 1 FROM rules);
