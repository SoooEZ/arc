CREATE TABLE data_sources (
    id VARCHAR(80) PRIMARY KEY,
    name VARCHAR(160) NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE data_source_versions (
    source_id VARCHAR(80) NOT NULL REFERENCES data_sources(id),
    version INTEGER NOT NULL,
    definition JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY(source_id, version)
);
INSERT INTO data_sources(id,name) VALUES ('country-tax','Country tax rates');
INSERT INTO data_source_versions(source_id,version,definition) VALUES ('country-tax',1,'{"kind":"LOOKUP","parameters":[{"name":"key","type":"STRING","required":true}],"entries":{"US":{"rate":0.07,"currency":"USD"},"GB":{"rate":0.20,"currency":"GBP"},"DE":{"rate":0.19,"currency":"EUR"}},"timeoutMs":3000}');
