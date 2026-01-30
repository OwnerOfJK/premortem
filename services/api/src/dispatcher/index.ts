import { type Consumer } from "kafkajs";
import {
  KAFKA_TOPICS,
  SQS_QUEUES,
  idempotencyKey,
  type TimelineEvent,
  type RootCauseProposedEvent,
} from "@premortem/shared";
import { sendSqsMessage } from "../lib/sqs.js";
import { kafka } from "../lib/kafka.js";

const RCA_CONFIDENCE_THRESHOLD = 0.7;

let consumer: Consumer | null = null;
const processedKeys = new Set<string>();

export async function startDispatcher(): Promise<void> {
  consumer = kafka.consumer({
    groupId: "dispatcher",
    retry: { initialRetryTime: 1000, retries: 10 },
  });
  await consumer.connect();
  await consumer.subscribe({
    topic: KAFKA_TOPICS.TIMELINE,
    fromBeginning: false,
  });

  console.log("Dispatcher started, consuming from", KAFKA_TOPICS.TIMELINE);

  await consumer.run({
    autoCommit: true,
    eachMessage: async ({ message }) => {
      if (!message.value) return;

      const event: TimelineEvent = JSON.parse(message.value.toString());
      const key = idempotencyKey(
        event.tenant_id,
        event.incident_id,
        event.event_type,
      );

      if (processedKeys.has(key)) {
        console.log(`Dispatcher skipping duplicate: ${key}`);
        return;
      }

      switch (event.event_type) {
        case "IncidentDetected":
          await sendSqsMessage(SQS_QUEUES.CONTEXT_BUILDER_TASKS, event);
          console.log(
            `Dispatched IncidentDetected to ${SQS_QUEUES.CONTEXT_BUILDER_TASKS}: ${event.incident_id}`,
          );
          break;
        case "ContextBuilt":
          await sendSqsMessage(SQS_QUEUES.RCA_TASKS, event);
          console.log(
            `Dispatched ContextBuilt to ${SQS_QUEUES.RCA_TASKS}: ${event.incident_id}`,
          );
          break;
        case "RootCauseProposed": {
          const rcaEvent = event as RootCauseProposedEvent;
          const queue =
            rcaEvent.payload.confidence >= RCA_CONFIDENCE_THRESHOLD
              ? SQS_QUEUES.FIX_TASKS
              : SQS_QUEUES.INSTRUMENTATION_TASKS;
          await sendSqsMessage(queue, event);
          console.log(
            `Dispatched RootCauseProposed to ${queue}: ${event.incident_id} (confidence=${rcaEvent.payload.confidence})`,
          );
          break;
        }
        default:
          console.log(
            `Dispatcher ignoring event type: ${event.event_type}`,
          );
      }

      // Mark as processed only after successful delivery
      processedKeys.add(key);
    },
  });
}

export async function stopDispatcher(): Promise<void> {
  if (consumer) {
    await consumer.disconnect();
    consumer = null;
    console.log("Dispatcher stopped");
  }
}
