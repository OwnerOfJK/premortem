import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@clickhouse/client";
import pg from "pg";
import { Kafka, type Consumer } from "kafkajs";
import { newEventId } from "@premortem/shared";
import { detectSpikes } from "./detect.js";
import { disconnectProducer } from "../lib/kafka.js";
import { db } from "../lib/postgres.js";

/*
 * Integration test: requires `just up && just migrate && just create-topics && just create-queues`
 * Exercises the full detection pipeline:
 *   1. Insert raw events into ClickHouse → materialized view populates error_frequency
 *   2. Run detectSpikes() → creates incident in Postgres, produces Kafka event
 *   3. Verify Postgres row, Kafka message, and SQS delivery (via dispatcher or directly)
 */

const TENANT_ID = "00000000-0000-0000-0000-000000000001";
const SERVICE = "test-service";
// Unique signature per test run to avoid collisions with prior data
const ERROR_SIGNATURE = `test_sig_${Date.now().toString(16)}`;
const ERROR_TYPE = "TestError";
const ERROR_VALUE = "something broke in test";

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST || "http://localhost:8123",
  database: process.env.CLICKHOUSE_DB || "premortem",
  username: process.env.CLICKHOUSE_USER || "premortem_user",
  password: process.env.CLICKHOUSE_PASSWORD || "premortem_pw",
});

const pgPool = new pg.Pool({
  host: process.env.POSTGRES_HOST || "localhost",
  port: Number(process.env.POSTGRES_PORT) || 5432,
  database: process.env.POSTGRES_DB || "premortem",
  user: process.env.POSTGRES_USER || "premortem_user",
  password: process.env.POSTGRES_PASSWORD || "premortem_pw",
});

const kafka = new Kafka({
  clientId: "test-consumer",
  brokers: (process.env.KAFKA_BROKERS || "localhost:9092").split(","),
});

describe("Detector integration", () => {
  let kafkaConsumer: Consumer;
  const kafkaMessages: string[] = [];

  beforeAll(async () => {
    // Set up Kafka consumer to capture timeline events
    kafkaConsumer = kafka.consumer({
      groupId: `test-detector-${Date.now()}`,
    });
    await kafkaConsumer.connect();
    await kafkaConsumer.subscribe({
      topic: "debugging.timeline",
      fromBeginning: false,
    });
    await kafkaConsumer.run({
      eachMessage: async ({ message }) => {
        if (message.value) {
          kafkaMessages.push(message.value.toString());
        }
      },
    });

    // Clean up any previous test incidents for this signature
    await pgPool.query(
      "DELETE FROM incidents WHERE error_signature = $1",
      [ERROR_SIGNATURE],
    );
  });

  afterAll(async () => {
    await kafkaConsumer.disconnect();
    await disconnectProducer();
    await pgPool.end();
    await db.destroy();
    await clickhouse.close();
  });

  it("detects a spike and creates incident → Kafka event → Postgres row", async () => {
    // Step 1: Seed ClickHouse with enough events to exceed threshold (default 5)
    const eventCount = 6;
    const rows = Array.from({ length: eventCount }, (_, i) => ({
      event_id: newEventId(),
      tenant_id: TENANT_ID,
      source: "test",
      error_type: ERROR_TYPE,
      error_value: ERROR_VALUE,
      error_signature: ERROR_SIGNATURE,
      level: "error",
      service: SERVICE,
      environment: "test",
      platform: "node",
      stacktrace: "[]",
      tags: {},
      raw_payload: "{}",
      deploy_hash: "",
      event_timestamp: new Date().toISOString(),
    }));

    await clickhouse.insert({
      table: "raw_events",
      values: rows,
      format: "JSONEachRow",
      clickhouse_settings: {
        date_time_input_format: "best_effort",
        async_insert: 0,
        wait_for_async_insert: 1,
      },
    });

    // Step 2: Verify error_frequency MV has the data
    // Give the MV a moment to populate
    await sleep(1000);

    const freqResult = await clickhouse.query({
      query: `
        SELECT sum(event_count) as total
        FROM error_frequency FINAL
        WHERE tenant_id = {tenant_id:String}
          AND error_signature = {error_signature:String}
          AND time_bucket >= now() - INTERVAL 5 MINUTE
      `,
      query_params: {
        tenant_id: TENANT_ID,
        error_signature: ERROR_SIGNATURE,
      },
      format: "JSONEachRow",
    });
    const freqRows = await freqResult.json<{ total: string }>();
    console.log("error_frequency total:", freqRows[0]?.total);
    expect(Number(freqRows[0]?.total)).toBeGreaterThanOrEqual(eventCount);

    // Step 3: Run the detector
    await detectSpikes();

    // Step 4: Verify Postgres incident was created
    const pgResult = await pgPool.query(
      "SELECT * FROM incidents WHERE error_signature = $1 AND tenant_id = $2",
      [ERROR_SIGNATURE, TENANT_ID],
    );
    expect(pgResult.rows.length).toBe(1);
    const incident = pgResult.rows[0];
    expect(incident.status).toBe("detected");
    expect(incident.service).toBe(SERVICE);
    expect(incident.error_type).toBe(ERROR_TYPE);
    expect(incident.incident_id).toMatch(/^inc_/);
    console.log("Postgres incident:", incident.incident_id);

    // Step 5: Verify Kafka message was produced
    // Wait a bit for the consumer to receive it
    await sleep(2000);

    const matchingKafka = kafkaMessages.find((msg) => {
      const parsed = JSON.parse(msg);
      return (
        parsed.event_type === "IncidentDetected" &&
        parsed.incident_id === incident.incident_id
      );
    });
    expect(matchingKafka).toBeDefined();
    const kafkaEvent = JSON.parse(matchingKafka!);
    expect(kafkaEvent.payload.error_signature).toBe(ERROR_SIGNATURE);
    expect(kafkaEvent.payload.service).toBe(SERVICE);
    expect(kafkaEvent.payload.spike_count).toBeGreaterThanOrEqual(eventCount);
    console.log("Kafka event:", kafkaEvent.event_type, kafkaEvent.incident_id);

    // Step 6: Running detectSpikes again should NOT create a duplicate
    await detectSpikes();
    const pgResult2 = await pgPool.query(
      "SELECT * FROM incidents WHERE error_signature = $1 AND tenant_id = $2",
      [ERROR_SIGNATURE, TENANT_ID],
    );
    expect(pgResult2.rows.length).toBe(1);
    console.log("Idempotency check passed: no duplicate incident created");
  });
});

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
