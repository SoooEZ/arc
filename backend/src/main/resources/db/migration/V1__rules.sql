CREATE TABLE rules (
    id VARCHAR(80) PRIMARY KEY,
    name VARCHAR(160) NOT NULL,
    description VARCHAR(2000) NOT NULL DEFAULT '',
    kind VARCHAR(30) NOT NULL CHECK (kind IN ('DECISION_TREE', 'FORMULA', 'RULE')),
    draft JSONB NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    published_version INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE rule_versions (
    rule_id VARCHAR(80) NOT NULL REFERENCES rules(id),
    version INTEGER NOT NULL,
    definition JSONB NOT NULL,
    published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (rule_id, version)
);
