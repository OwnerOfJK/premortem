CREATE MATERIALIZED VIEW IF NOT EXISTS error_frequency_mv
TO error_frequency
AS
SELECT
    tenant_id,
    service,
    error_signature,
    toStartOfFiveMinutes(event_timestamp) AS time_bucket,
    count() AS event_count
FROM raw_events
GROUP BY tenant_id, service, error_signature, time_bucket;
