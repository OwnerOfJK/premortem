import { z } from "zod";

const envSchema = z.object({
  CLICKHOUSE_HOST: z.string().default("http://localhost:8123"),
  CLICKHOUSE_DB: z.string().default("premortem"),
  CLICKHOUSE_USER: z.string().default("default"),
  CLICKHOUSE_PASSWORD: z.string().default(""),
  API_PORT: z.coerce.number().default(3000),

  // Kafka
  KAFKA_BROKERS: z.string().default("localhost:9092"),

  // Postgres
  POSTGRES_HOST: z.string().default("localhost"),
  POSTGRES_PORT: z.coerce.number().default(5432),
  POSTGRES_DB: z.string().default("premortem"),
  POSTGRES_USER: z.string().default("premortem"),
  POSTGRES_PASSWORD: z.string().default("premortem"),

  // SQS (LocalStack)
  SQS_ENDPOINT: z.string().default("http://localhost:4566"),
  AWS_REGION: z.string().default("us-east-1"),
  AWS_ACCESS_KEY_ID: z.string().default("test"),
  AWS_SECRET_ACCESS_KEY: z.string().default("test"),

  // Detector
  DETECTOR_POLL_INTERVAL_MS: z.coerce.number().default(30000),
  DETECTOR_SPIKE_THRESHOLD: z.coerce.number().default(5),
});

export const config = envSchema.parse(process.env);
