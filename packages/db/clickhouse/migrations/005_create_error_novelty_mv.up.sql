CREATE MATERIALIZED VIEW IF NOT EXISTS error_novelty_mv
TO error_novelty
AS
SELECT
    tenant_id,
    service,
    error_signature,
    deploy_hash,
    minState(event_timestamp) AS first_seen,
    maxState(event_timestamp) AS last_seen
FROM raw_events
GROUP BY tenant_id, service, error_signature, deploy_hash;
