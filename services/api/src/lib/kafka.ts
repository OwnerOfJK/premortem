import { Kafka, type Producer } from "kafkajs";
import { KAFKA_TOPICS, type TimelineEvent } from "@premortem/shared";
import { config } from "../config.js";

const kafka = new Kafka({
  clientId: "premortem-api",
  brokers: config.KAFKA_BROKERS.split(","),
  retry: {
    initialRetryTime: 1000,
    retries: 10,
  },
});

let producerInstance: Producer | null = null;

export async function getProducer(): Promise<Producer> {
  if (!producerInstance) {
    producerInstance = kafka.producer();
    await producerInstance.connect();
  }
  return producerInstance;
}

export async function produceTimelineEvent(
  event: TimelineEvent,
): Promise<void> {
  const producer = await getProducer();
  await producer.send({
    topic: KAFKA_TOPICS.TIMELINE,
    messages: [
      {
        key: event.incident_id,
        value: JSON.stringify(event),
      },
    ],
  });
}

export async function disconnectProducer(): Promise<void> {
  if (producerInstance) {
    await producerInstance.disconnect();
    producerInstance = null;
  }
}

export { kafka };
