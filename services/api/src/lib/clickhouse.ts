import { createClient } from "@clickhouse/client";
import { config } from "../config.js";

export const clickhouse = createClient({
  url: config.CLICKHOUSE_HOST,
  database: config.CLICKHOUSE_DB,
  username: config.CLICKHOUSE_USER,
  password: config.CLICKHOUSE_PASSWORD,
});

export interface RawEventRow {
  event_id: string;
  tenant_id: string;
  source: string;
  error_type: string;
  error_value: string;
  error_signature: string;
  level: string;
  service: string;
  environment: string;
  platform: string;
  stacktrace: string;
  tags: Record<string, string>;
  raw_payload: string;
  deploy_hash: string;
  event_timestamp: string;
}

export async function insertRawEvent(event: RawEventRow): Promise<void> {
  await clickhouse.insert({
    table: "raw_events",
    values: [event],
    format: "JSONEachRow",
    clickhouse_settings: {
      date_time_input_format: "best_effort",
      async_insert: 0,
      wait_for_async_insert: 1,
    },
  });
}
