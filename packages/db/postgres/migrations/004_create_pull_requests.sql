CREATE TABLE IF NOT EXISTS pull_requests (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    incident_id     UUID NOT NULL REFERENCES incidents(id),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    provider        VARCHAR(100) NOT NULL DEFAULT 'github',
    repo            VARCHAR(255) NOT NULL,
    pr_number       INTEGER NOT NULL,
    pr_url          TEXT NOT NULL,
    branch          VARCHAR(255) NOT NULL DEFAULT '',
    status          VARCHAR(50) NOT NULL DEFAULT 'open',
    merged_at       TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pull_requests_incident ON pull_requests(incident_id);
