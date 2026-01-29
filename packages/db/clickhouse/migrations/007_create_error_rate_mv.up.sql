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
