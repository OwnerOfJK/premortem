CREATE TABLE IF NOT EXISTS integrations (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    provider        VARCHAR(100) NOT NULL,
    config          JSONB NOT NULL DEFAULT '{}',
    webhook_secret  VARCHAR(255),
    enabled         BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_integrations_tenant_provider ON integrations(tenant_id, provider);
