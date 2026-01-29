CREATE DATABASE IF NOT EXISTS premortem;

USE premortem;

CREATE TABLE IF NOT EXISTS raw_events
(
    event_id        String,
    tenant_id       String,
    source          String DEFAULT 'sentry',
    error_type      String,
    error_value     String,
    error_signature String,
    level           String DEFAULT 'error',
    service         String,
    environment     String DEFAULT 'production',
    platform        String DEFAULT '',
    stacktrace      String DEFAULT '',
    tags            Map(String, String),
    raw_payload     String,
    deploy_hash     String DEFAULT '',
    event_timestamp DateTime64(3),
    ingested_at     DateTime64(3) DEFAULT now64(3)
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(event_timestamp)
ORDER BY (tenant_id, service, error_signature, event_timestamp)
TTL toDateTime(event_timestamp) + INTERVAL 90 DAY;
