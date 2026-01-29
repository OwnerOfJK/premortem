CREATE TABLE IF NOT EXISTS error_rate
(
    tenant_id     String,
    service       String,
    time_bucket   DateTime,
    total_events  UInt64,
    error_events  UInt64
)
ENGINE = SummingMergeTree((total_events, error_events))
ORDER BY (tenant_id, service, time_bucket);
