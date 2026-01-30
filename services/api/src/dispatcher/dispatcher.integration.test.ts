import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  GetQueueUrlCommand,
  PurgeQueueCommand,
} from "@aws-sdk/client-sqs";
import { Kafka, type Producer } from "kafkajs";
import { SQS_QUEUES, KAFKA_TOPICS } from "@premortem/shared";
import type {
  ContextBuiltEvent,
  RootCauseProposedEvent,
  IncidentDetectedEvent,
} from "@premortem/shared";
import { startDispatcher, stopDispatcher } from "./index.js";

/*
 * Integration test: requires `just up && just create-topics && just create-queues`
 * Exercises the dispatcher routing logic for the newly added event types:
 *   1. IncidentDetected → context-builder-tasks SQS
 *   2. ContextBuilt → rca-tasks SQS
 *   3. RootCauseProposed (high confidence) → fix-tasks SQS
 *   4. RootCauseProposed (low confidence) → instrumentation-tasks SQS
 */

const sqsClient = new SQSClient({
  region: process.env.AWS_REGION || "us-east-1",
  endpoint: process.env.SQS_ENDPOINT || "http://localhost:4566",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || "test",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "test",
  },
});

const kafka = new Kafka({
  clientId: "test-dispatcher-producer",
  brokers: (process.env.KAFKA_BROKERS || "localhost:9092").split(","),
});

const TENANT_ID = "00000000-0000-0000-0000-000000000001";

async function getQueueUrl(queueName: string): Promise<string> {
  const result = await sqsClient.send(
    new GetQueueUrlCommand({ QueueName: queueName }),
  );
  return result.QueueUrl!;
}

async function drainQueue(queueName: string): Promise<void> {
  const url = await getQueueUrl(queueName);
  try {
    await sqsClient.send(new PurgeQueueCommand({ QueueUrl: url }));
    // PurgeQueue can take up to 60s; wait a bit for it to take effect
    await sleep(1000);
  } catch {
    // PurgeQueue may fail if called too recently; ignore
  }
}

async function receiveSqsMessageMatching(
  queueName: string,
  predicate: (body: Record<string, unknown>) => boolean,
  timeoutMs: number,
): Promise<string | undefined> {
  const url = await getQueueUrl(queueName);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const response = await sqsClient.send(
      new ReceiveMessageCommand({
        QueueUrl: url,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 2,
      }),
    );
    for (const message of response.Messages ?? []) {
      if (!message.Body || !message.ReceiptHandle) continue;
      const parsed = JSON.parse(message.Body);
      // Always delete the message so it doesn't interfere with other tests
      await sqsClient.send(
        new DeleteMessageCommand({ QueueUrl: url, ReceiptHandle: message.ReceiptHandle }),
      );
      if (predicate(parsed)) {
        return message.Body;
      }
    }
    await sleep(500);
  }
  return undefined;
}

describe("Dispatcher routing integration", () => {
  let producer: Producer;

  beforeAll(async () => {
    // Drain target queues to avoid stale messages
    await Promise.all([
      drainQueue(SQS_QUEUES.CONTEXT_BUILDER_TASKS),
      drainQueue(SQS_QUEUES.RCA_TASKS),
      drainQueue(SQS_QUEUES.FIX_TASKS),
      drainQueue(SQS_QUEUES.INSTRUMENTATION_TASKS),
    ]);

    // Connect Kafka producer
    producer = kafka.producer();
    await producer.connect();

    // Start the dispatcher
    await startDispatcher();

    // Give the dispatcher consumer time to join the group
    await sleep(3000);
  });

  afterAll(async () => {
    await stopDispatcher();
    await producer.disconnect();
  });

  it("routes IncidentDetected to context-builder-tasks SQS", async () => {
    const incidentId = `inc_disp_detected_${Date.now().toString(16)}`;

    const event: IncidentDetectedEvent = {
      time: new Date().toISOString(),
      tenant_id: TENANT_ID,
      incident_id: incidentId,
      event_type: "IncidentDetected",
      payload: {
        error_signature: "sig_test_dispatch",
        service: "api-gateway",
        error_type: "TimeoutError",
        error_value: "Request timed out",
        spike_count: 12,
        window_minutes: 5,
      },
    };

    await producer.send({
      topic: KAFKA_TOPICS.TIMELINE,
      messages: [{ key: incidentId, value: JSON.stringify(event) }],
    });

    const msg = await receiveSqsMessageMatching(
      SQS_QUEUES.CONTEXT_BUILDER_TASKS,
      (body) => body.incident_id === incidentId,
      10_000,
    );
    expect(msg).toBeDefined();
    const parsed = JSON.parse(msg!);
    expect(parsed.event_type).toBe("IncidentDetected");
    expect(parsed.incident_id).toBe(incidentId);
  });

  it("routes ContextBuilt to rca-tasks SQS", async () => {
    const incidentId = `inc_disp_ctx_${Date.now().toString(16)}`;

    const event: ContextBuiltEvent = {
      time: new Date().toISOString(),
      tenant_id: TENANT_ID,
      incident_id: incidentId,
      event_type: "ContextBuilt",
      payload: {
        error_count: 25,
        time_range_minutes: 60,
        services: ["payments-service"],
        has_deploy_info: true,
        has_code_context: false,
        context_summary: "## Error Summary\n- Type: NullPointerException",
      },
    };

    await producer.send({
      topic: KAFKA_TOPICS.TIMELINE,
      messages: [{ key: incidentId, value: JSON.stringify(event) }],
    });

    const msg = await receiveSqsMessageMatching(
      SQS_QUEUES.RCA_TASKS,
      (body) => body.incident_id === incidentId,
      10_000,
    );
    expect(msg).toBeDefined();
    const parsed = JSON.parse(msg!);
    expect(parsed.event_type).toBe("ContextBuilt");
    expect(parsed.incident_id).toBe(incidentId);
    expect(parsed.payload.context_summary).toContain("NullPointerException");
  });

  it("routes high-confidence RootCauseProposed to fix-tasks SQS", async () => {
    const incidentId = `inc_disp_rca_hi_${Date.now().toString(16)}`;

    const event: RootCauseProposedEvent = {
      time: new Date().toISOString(),
      tenant_id: TENANT_ID,
      incident_id: incidentId,
      event_type: "RootCauseProposed",
      payload: {
        hypothesis: "Deploy abc123 introduced a null reference in processPayment",
        confidence: 0.85,
        evidence_refs: ["stacktrace frame processPayment:42", "deploy abc123"],
      },
    };

    await producer.send({
      topic: KAFKA_TOPICS.TIMELINE,
      messages: [{ key: incidentId, value: JSON.stringify(event) }],
    });

    const msg = await receiveSqsMessageMatching(
      SQS_QUEUES.FIX_TASKS,
      (body) => body.incident_id === incidentId,
      10_000,
    );
    expect(msg).toBeDefined();
    const parsed: RootCauseProposedEvent = JSON.parse(msg!);
    expect(parsed.event_type).toBe("RootCauseProposed");
    expect(parsed.incident_id).toBe(incidentId);
    expect(parsed.payload.confidence).toBe(0.85);
  });

  it("routes low-confidence RootCauseProposed to instrumentation-tasks SQS", async () => {
    const incidentId = `inc_disp_rca_lo_${Date.now().toString(16)}`;

    const event: RootCauseProposedEvent = {
      time: new Date().toISOString(),
      tenant_id: TENANT_ID,
      incident_id: incidentId,
      event_type: "RootCauseProposed",
      payload: {
        hypothesis: "Possibly related to network latency but insufficient evidence",
        confidence: 0.4,
        evidence_refs: ["intermittent timeout pattern"],
      },
    };

    await producer.send({
      topic: KAFKA_TOPICS.TIMELINE,
      messages: [{ key: incidentId, value: JSON.stringify(event) }],
    });

    const msg = await receiveSqsMessageMatching(
      SQS_QUEUES.INSTRUMENTATION_TASKS,
      (body) => body.incident_id === incidentId,
      10_000,
    );
    expect(msg).toBeDefined();
    const parsed: RootCauseProposedEvent = JSON.parse(msg!);
    expect(parsed.event_type).toBe("RootCauseProposed");
    expect(parsed.incident_id).toBe(incidentId);
    expect(parsed.payload.confidence).toBe(0.4);
  });

  it("routes boundary confidence (exactly 0.7) to fix-tasks SQS", async () => {
    const incidentId = `inc_disp_rca_boundary_${Date.now().toString(16)}`;

    const event: RootCauseProposedEvent = {
      time: new Date().toISOString(),
      tenant_id: TENANT_ID,
      incident_id: incidentId,
      event_type: "RootCauseProposed",
      payload: {
        hypothesis: "Boundary confidence test hypothesis",
        confidence: 0.7,
        evidence_refs: ["boundary test"],
      },
    };

    await producer.send({
      topic: KAFKA_TOPICS.TIMELINE,
      messages: [{ key: incidentId, value: JSON.stringify(event) }],
    });

    // Exactly 0.7 should go to fix-tasks (>= threshold)
    const msg = await receiveSqsMessageMatching(
      SQS_QUEUES.FIX_TASKS,
      (body) => body.incident_id === incidentId,
      10_000,
    );
    expect(msg).toBeDefined();
    const parsed: RootCauseProposedEvent = JSON.parse(msg!);
    expect(parsed.incident_id).toBe(incidentId);
    expect(parsed.payload.confidence).toBe(0.7);
  });
});

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
