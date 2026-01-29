CREATE TABLE IF NOT EXISTS incidents (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    incident_id     VARCHAR(255) NOT NULL UNIQUE,
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    service         VARCHAR(255) NOT NULL,
    error_signature VARCHAR(255) NOT NULL,
    error_type      VARCHAR(255) NOT NULL DEFAULT '',
    error_value     TEXT NOT NULL DEFAULT '',
    status          VARCHAR(50) NOT NULL DEFAULT 'detected',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_incidents_tenant_status ON incidents(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_incidents_error_sig ON incidents(tenant_id, error_signature);
