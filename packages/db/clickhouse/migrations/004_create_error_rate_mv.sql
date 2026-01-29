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

CREATE MATERIALIZED VIEW IF NOT EXISTS error_rate_mv
TO error_rate
AS
SELECT
    tenant_id,
    service,
    toStartOfFiveMinutes(event_timestamp) AS time_bucket,
    count() AS total_events,
    countIf(level = 'error' OR level = 'fatal') AS error_events
FROM raw_events
GROUP BY tenant_id, service, time_bucket;
