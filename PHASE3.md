# Phase 3: Context Builder + RCA Agent Pipeline

## Overview

Phase 3 completes the first three automated stages of the incident debugging pipeline. After the detector identifies an error spike and emits an `IncidentDetected` event, the system now automatically gathers context from ClickHouse and runs AI-powered root cause analysis via a new Python microservice.

## Pipeline Flow

```
Raw Errors --> ClickHouse
                  |
          [Detector] (Phase 2)
                  |
        IncidentDetected event --> Kafka timeline
                  |
          [Dispatcher] routes to context-builder-tasks SQS
                  |
        [Context Builder] (NEW) queries ClickHouse for error samples, counts, deploys
                  |
          ContextBuilt event --> Kafka timeline
                  |
          [Dispatcher] routes to rca-tasks SQS
                  |
          [RCA Agent] (NEW) calls GPT-4o-mini via Modal + LangChain
                  |
        RootCauseProposed event --> Kafka timeline
                  |
          [Dispatcher] routes based on confidence:
              >= 0.7 --> fix-tasks SQS
              <  0.7 --> instrumentation-tasks SQS
```

## What Was Built

### 1. Context Builder (`services/api/src/context-builder/`)

An SQS consumer running inside the API service that enriches incidents with debugging context.

| File | Purpose |
|------|---------|
| `index.ts` | SQS poll loop consuming from `context-builder-tasks`, produces `ContextBuilt` events to Kafka |
| `build.ts` | Core logic: takes an `IncidentDetectedEvent`, queries ClickHouse, assembles a structured markdown context summary |
| `queries.ts` | ClickHouse queries for error samples (last 60 min), aggregate error count, and distinct deploy hashes |

The context summary includes:
- Error type, message, and affected services
- Total occurrence count and spike count
- Recent deploy hashes (if available)
- Up to 5 sample stacktraces (top 10 frames each)

### 2. RCA Agent Service (`services/agents/`)

A new Python microservice that performs AI-powered root cause analysis.

| File | Purpose |
|------|---------|
| `main.py` | Entry point, starts the RCA consumer |
| `config.py` | Pydantic settings for Kafka, SQS, OpenAI, Modal, Langfuse |
| `sqs_consumer.py` | Generic SQS poll loop with graceful SIGTERM/SIGINT shutdown |
| `kafka_producer.py` | Confluent Kafka producer for emitting timeline events |
| `rca/consumer.py` | Binds `rca-tasks` SQS queue to the RCA handler |
| `rca/agent.py` | Handler: receives `ContextBuilt`, calls Modal, emits `RootCauseProposed` |
| `rca/modal_fn.py` | Modal serverless function running GPT-4o-mini with structured JSON output |
| `rca/prompts.py` | System and user prompt templates for the RCA LLM call |
| `Dockerfile` | Production container image |
| `pyproject.toml` | Python package config with dependencies |

The RCA agent:
- Receives the context summary from the context builder
- Sends it to GPT-4o-mini (via LangChain on Modal) with a structured prompt
- Returns a JSON response: `{ hypothesis, confidence, evidence_refs }`
- All LLM calls are traced via Langfuse for observability

### 3. Dispatcher Enhancements (`services/api/src/dispatcher/index.ts`)

Two new routing rules added:

| Event Type | Destination Queue | Condition |
|------------|------------------|-----------|
| `ContextBuilt` | `rca-tasks` | Always |
| `RootCauseProposed` | `fix-tasks` | `confidence >= 0.7` |
| `RootCauseProposed` | `instrumentation-tasks` | `confidence < 0.7` |

### 4. Infrastructure Changes

| File | Change |
|------|--------|
| `docker-compose.yml` | Added `agents` service with Kafka, SQS, OpenAI, Modal, Langfuse env vars |
| `.env.example` | Added `OPENAI_API_KEY`, `MODAL_TOKEN_ID`, `MODAL_TOKEN_SECRET`, `LANGFUSE_*` |
| `justfile` | Added `agents` recipe to run the Python service locally |
| `services/api/src/index.ts` | Starts/stops the context builder consumer on boot/shutdown |
| `services/api/src/lib/sqs.ts` | Exported `getQueueUrl` for use by the context builder |

## Integration Tests

All tests require infrastructure: `just up && just migrate && just create-topics && just create-queues`

### `context-builder/build.integration.test.ts`

Tests the `buildContext()` function directly against real ClickHouse data.

- Seeds ClickHouse with error events (with deploy hashes and stacktraces)
- Calls `buildContext()` with an `IncidentDetectedEvent`
- Verifies the `ContextBuiltEvent` structure: error count, services, deploy info, summary content
- Tests the no-deploy-info edge case (events without deploy hashes)

### `context-builder/context-builder.integration.test.ts`

Full end-to-end consumer test.

- Seeds ClickHouse with error events
- Sends an `IncidentDetected` event to the `context-builder-tasks` SQS queue
- Starts the context builder consumer
- Verifies a `ContextBuilt` event appears on the Kafka timeline topic
- Validates payload fields and context summary content (error type, deploy hash, stacktrace frames)

### `dispatcher/dispatcher.integration.test.ts`

Tests all dispatcher routing rules including the new ones.

- `IncidentDetected` --> `context-builder-tasks` SQS
- `ContextBuilt` --> `rca-tasks` SQS
- `RootCauseProposed` (confidence 0.85) --> `fix-tasks` SQS
- `RootCauseProposed` (confidence 0.4) --> `instrumentation-tasks` SQS
- `RootCauseProposed` (confidence exactly 0.7) --> `fix-tasks` SQS (boundary case)

### Running Tests

```bash
# All integration tests
cd services/api && pnpm test

# Individual suites
cd services/api && pnpm vitest run src/context-builder/build.integration.test.ts
cd services/api && pnpm vitest run src/context-builder/context-builder.integration.test.ts
cd services/api && pnpm vitest run src/dispatcher/dispatcher.integration.test.ts
```

## Not Yet Tested

The RCA agent (Python/Modal) depends on external LLM infrastructure and would require mocked Modal calls for automated testing. This is the natural next step for Phase 4 test coverage.
