// Kafka topics
export const KAFKA_TOPICS = {
  TIMELINE: "debugging.timeline",
  INTERNAL: "debugging.internal",
  EVALUATION: "debugging.evaluation",
} as const;

// SQS queue names
export const SQS_QUEUES = {
  CONTEXT_BUILDER_TASKS: "context-builder-tasks",
  RCA_TASKS: "rca-tasks",
  FIX_TASKS: "fix-tasks",
  INSTRUMENTATION_TASKS: "instrumentation-tasks",
  EVALUATION_TASKS: "evaluation-tasks",
} as const;

// ClickHouse table names
export const CLICKHOUSE_TABLES = {
  RAW_EVENTS: "raw_events",
  ERROR_FREQUENCY: "error_frequency_mv",
  ERROR_NOVELTY: "error_novelty_mv",
  ERROR_RATE: "error_rate_mv",
} as const;
