import {
  ReceiveMessageCommand,
  DeleteMessageCommand,
} from "@aws-sdk/client-sqs";
import { SQS_QUEUES, type IncidentDetectedEvent } from "@premortem/shared";
import { sqsClient, getQueueUrl } from "../lib/sqs.js";
import { produceTimelineEvent } from "../lib/kafka.js";
import { buildContext } from "./build.js";

let intervalHandle: ReturnType<typeof setInterval> | null = null;

const POLL_INTERVAL_MS = 5_000;
const MAX_MESSAGES = 10;
const WAIT_TIME_SECONDS = 5;

async function pollOnce(): Promise<void> {
  const queueUrl = await getQueueUrl(SQS_QUEUES.CONTEXT_BUILDER_TASKS);

  const response = await sqsClient.send(
    new ReceiveMessageCommand({
      QueueUrl: queueUrl,
      MaxNumberOfMessages: MAX_MESSAGES,
      WaitTimeSeconds: WAIT_TIME_SECONDS,
    }),
  );

  if (!response.Messages || response.Messages.length === 0) return;

  for (const message of response.Messages) {
    if (!message.Body || !message.ReceiptHandle) continue;

    try {
      const event: IncidentDetectedEvent = JSON.parse(message.Body);
      const contextEvent = await buildContext(event);
      await produceTimelineEvent(contextEvent);
      console.log(
        `Context built for incident ${event.incident_id}`,
      );
    } catch (err) {
      console.error("Context builder failed for message:", err);
      continue;
    }

    await sqsClient.send(
      new DeleteMessageCommand({
        QueueUrl: queueUrl,
        ReceiptHandle: message.ReceiptHandle,
      }),
    );
  }
}

export function startContextBuilder(): void {
  console.log("Starting context builder consumer");

  pollOnce().catch((err) =>
    console.error("Context builder tick failed:", err),
  );

  intervalHandle = setInterval(() => {
    pollOnce().catch((err) =>
      console.error("Context builder tick failed:", err),
    );
  }, POLL_INTERVAL_MS);
}

export function stopContextBuilder(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    console.log("Context builder stopped");
  }
}
