import { z } from "zod";

const envSchema = z.object({
  CLICKHOUSE_HOST: z.string().default("http://localhost:8123"),
  CLICKHOUSE_DB: z.string().default("premortem"),
  CLICKHOUSE_USER: z.string().default("default"),
  CLICKHOUSE_PASSWORD: z.string().default(""),
  API_PORT: z.coerce.number().default(3000),
});

export const config = envSchema.parse(process.env);
