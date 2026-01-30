import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@clickhouse/client";
import {
  SQSClient,
  SendMessageCommand,
  GetQueueUrlCommand,
} from "@aws-sdk/client-sqs";
import { Kafka, type Consumer } from "kafkajs";
import { newEventId, SQS_QUEUES } from "@premortem/shared";
import type { IncidentDetectedEvent, ContextBuiltEvent } from "@premortem/shared";
import { startContextBuilder, stopContextBuilder } from "./index.js";
import { disconnectProducer } from "../lib/kafka.js";

/*
 * Integration test: requires `just up && just migrate && just create-topics && just create-queues`
 * Exercises the full context-builder consumer pipeline:
 *   1. Seed ClickHouse with raw error events
 *   2. Send an IncidentDetected event to the context-builder-tasks SQS queue
 *   3. Start the context builder consumer
 *   4. Verify a ContextBuilt event appears on the Kafka timeline topic
 */

const TENANT_ID = "00000000-0000-0000-0000-000000000001";
const SERVICE = "auth-service";
const ERROR_SIGNATURE = `ctx_e2e_test_${Date.now().toString(16)}`;
const ERROR_TYPE = "AuthenticationError";
const ERROR_VALUE = "Token expired during refresh";
const INCIDENT_ID = `inc_ctx_e2e_${Date.now().toString(16)}`;

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST || "http://localhost:8123",
  database: process.env.CLICKHOUSE_DB || "premortem",
  username: process.env.CLICKHOUSE_USER || "premortem_user",
  password: process.env.CLICKHOUSE_PASSWORD || "premortem_pw",
});

const sqsClient = new SQSClient({
  region: process.env.AWS_REGION || "us-east-1",
  endpoint: process.env.SQS_ENDPOINT || "http://localhost:4566",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || "test",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "test",
  },
});

const kafka = new Kafka({
  clientId: "test-ctx-consumer",
  brokers: (process.env.KAFKA_BROKERS || "localhost:9092").split(","),
});

describe("Context builder consumer integration", () => {
  let kafkaConsumer: Consumer;
  const kafkaMessages: string[] = [];

  beforeAll(async () => {
    // Set up Kafka consumer to capture timeline events
    kafkaConsumer = kafka.consumer({
      groupId: `test-ctx-builder-${Date.now()}`,
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

    // Seed ClickHouse with error events
    const rows = Array.from({ length: 10 }, () => ({
      event_id: newEventId(),
      tenant_id: TENANT_ID,
      source: "sentry",
      error_type: ERROR_TYPE,
      error_value: ERROR_VALUE,
      error_signature: ERROR_SIGNATURE,
      level: "error",
      service: SERVICE,
      environment: "production",
      platform: "node",
      stacktrace: [
        "Error: Token expired during refresh",
        "    at refreshToken (src/auth/refresh.ts:55:11)",
        "    at middleware (src/auth/middleware.ts:22:5)",
      ].join("\n"),
      tags: {},
      raw_payload: "{}",
      deploy_hash: "deploy_v2.3.1",
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

    // Wait for MV to populate
    await sleep(1000);
  });

  afterAll(async () => {
    stopContextBuilder();
    await kafkaConsumer.disconnect();
    await disconnectProducer();
    await clickhouse.close();
  });

  it("consumes IncidentDetected from SQS and produces ContextBuilt to Kafka", async () => {
    // Step 1: Send IncidentDetected event to the SQS queue
    const incidentEvent: IncidentDetectedEvent = {
      time: new Date().toISOString(),
      tenant_id: TENANT_ID,
      incident_id: INCIDENT_ID,
      event_type: "IncidentDetected",
      payload: {
        error_signature: ERROR_SIGNATURE,
        service: SERVICE,
        error_type: ERROR_TYPE,
        error_value: ERROR_VALUE,
        spike_count: 10,
        window_minutes: 5,
      },
    };

    const queueUrlResult = await sqsClient.send(
      new GetQueueUrlCommand({
        QueueName: SQS_QUEUES.CONTEXT_BUILDER_TASKS,
      }),
    );

    await sqsClient.send(
      new SendMessageCommand({
        QueueUrl: queueUrlResult.QueueUrl!,
        MessageBody: JSON.stringify(incidentEvent),
      }),
    );

    // Step 2: Start the context builder consumer
    startContextBuilder();

    // Step 3: Wait for the consumer to process and produce to Kafka
    const contextBuiltMsg = await waitForKafkaMessage(
      kafkaMessages,
      (msg) => {
        const parsed = JSON.parse(msg);
        return (
          parsed.event_type === "ContextBuilt" &&
          parsed.incident_id === INCIDENT_ID
        );
      },
      15_000,
    );

    expect(contextBuiltMsg).toBeDefined();
    const contextEvent: ContextBuiltEvent = JSON.parse(contextBuiltMsg!);

    // Verify the ContextBuilt event
    expect(contextEvent.event_type).toBe("ContextBuilt");
    expect(contextEvent.tenant_id).toBe(TENANT_ID);
    expect(contextEvent.incident_id).toBe(INCIDENT_ID);

    // Verify payload
    expect(contextEvent.payload.error_count).toBeGreaterThanOrEqual(10);
    expect(contextEvent.payload.time_range_minutes).toBe(60);
    expect(contextEvent.payload.services).toContain(SERVICE);
    expect(contextEvent.payload.has_deploy_info).toBe(true);

    // Verify context summary has key content
    const summary = contextEvent.payload.context_summary;
    expect(summary).toContain(ERROR_TYPE);
    expect(summary).toContain(ERROR_VALUE);
    expect(summary).toContain(SERVICE);
    expect(summary).toContain("deploy_v2.3.1");
    expect(summary).toContain("refreshToken");

    console.log(
      "Context builder E2E passed:",
      contextEvent.incident_id,
      `(${contextEvent.payload.services.join(", ")}, ${contextEvent.payload.error_count} errors)`,
    );
  });
});

async function waitForKafkaMessage(
  messages: string[],
  predicate: (msg: string) => boolean,
  timeoutMs: number,
): Promise<string | undefined> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const found = messages.find(predicate);
    if (found) return found;
    await sleep(500);
  }
  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
