import {
  SQSClient,
  SendMessageCommand,
  GetQueueUrlCommand,
} from "@aws-sdk/client-sqs";
import { config } from "../config.js";

const sqsClient = new SQSClient({
  region: config.AWS_REGION,
  endpoint: config.SQS_ENDPOINT,
  credentials: {
    accessKeyId: config.AWS_ACCESS_KEY_ID,
    secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
  },
});

const queueUrlCache = new Map<string, string>();

async function getQueueUrl(queueName: string): Promise<string> {
  const cached = queueUrlCache.get(queueName);
  if (cached) return cached;

  const result = await sqsClient.send(
    new GetQueueUrlCommand({ QueueName: queueName }),
  );
  const url = result.QueueUrl!;
  queueUrlCache.set(queueName, url);
  return url;
}

export async function sendSqsMessage(
  queueName: string,
  body: object,
): Promise<void> {
  const queueUrl = await getQueueUrl(queueName);
  await sqsClient.send(
    new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(body),
    }),
  );
}

export { sqsClient };
