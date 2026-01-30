import { clickhouse } from "../lib/clickhouse.js";

interface ErrorSampleRow {
  event_id: string;
  error_type: string;
  error_value: string;
  stacktrace: string;
  service: string;
  deploy_hash: string;
  event_timestamp: string;
}

interface ErrorCountRow {
  total: string;
}

interface DeployRow {
  deploy_hash: string;
}

export interface ContextData {
  errorSamples: ErrorSampleRow[];
  errorCount: number;
  deployHashes: string[];
}

export async function queryContextData(
  tenantId: string,
  errorSignature: string,
): Promise<ContextData> {
  // Error samples: recent raw_events, last 60 min, LIMIT 20
  const samplesResult = await clickhouse.query({
    query: `
      SELECT event_id, error_type, error_value, stacktrace, service, deploy_hash, event_timestamp
      FROM raw_events
      WHERE tenant_id = {tenant_id:String}
        AND error_signature = {error_signature:String}
        AND event_timestamp >= now() - INTERVAL 60 MINUTE
      ORDER BY event_timestamp DESC
      LIMIT 20
    `,
    query_params: { tenant_id: tenantId, error_signature: errorSignature },
    format: "JSONEachRow",
  });
  const errorSamples = await samplesResult.json<ErrorSampleRow>();

  // Error count: SUM from error_frequency FINAL for the same window
  const countResult = await clickhouse.query({
    query: `
      SELECT sum(event_count) as total
      FROM error_frequency FINAL
      WHERE tenant_id = {tenant_id:String}
        AND error_signature = {error_signature:String}
        AND time_bucket >= now() - INTERVAL 60 MINUTE
    `,
    query_params: { tenant_id: tenantId, error_signature: errorSignature },
    format: "JSONEachRow",
  });
  const countRows = await countResult.json<ErrorCountRow>();
  const errorCount = Number(countRows[0]?.total ?? 0);

  // Deploy info: distinct deploy_hash values from raw_events
  const deployResult = await clickhouse.query({
    query: `
      SELECT DISTINCT deploy_hash
      FROM raw_events
      WHERE tenant_id = {tenant_id:String}
        AND error_signature = {error_signature:String}
        AND deploy_hash != ''
        AND event_timestamp >= now() - INTERVAL 60 MINUTE
    `,
    query_params: { tenant_id: tenantId, error_signature: errorSignature },
    format: "JSONEachRow",
  });
  const deployRows = await deployResult.json<DeployRow>();
  const deployHashes = deployRows.map((r) => r.deploy_hash);

  return { errorSamples, errorCount, deployHashes };
}
