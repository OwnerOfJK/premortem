CREATE TABLE IF NOT EXISTS error_novelty
(
    tenant_id       String,
    service         String,
    error_signature String,
    deploy_hash     String,
    first_seen      AggregateFunction(min, DateTime64(3)),
    last_seen       AggregateFunction(max, DateTime64(3))
)
ENGINE = AggregatingMergeTree()
ORDER BY (tenant_id, service, error_signature, deploy_hash);
