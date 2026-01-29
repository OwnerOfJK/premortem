# Premortem: Implementation Plan

## Monorepo Directory Structure

```
premortem/
├── PRODUCT.md
├── README.md
├── .gitignore
├── docker-compose.yml
├── justfile                            # Recipes: up, down, migrate, seed, logs
├── .env.example
├── pnpm-workspace.yaml
│
├── packages/
│   ├── shared/                         # Shared TS library (event types, constants)
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── events/
│   │       │   ├── index.ts
│   │       │   ├── timeline.ts         # IncidentDetected, ContextBuilt, etc.
│   │       │   └── internal.ts
│   │       ├── constants.ts            # Topic names, queue names
│   │       └── utils/
│   │           ├── idempotency.ts
│   │           └── ids.ts
│   │
│   └── db/                             # Database migrations and schemas
│       ├── clickhouse/migrations/
│       ├── postgres/migrations/
│       └── scripts/
│
├── services/
│   ├── api/                            # Node.js Express API (TypeScript)
│   │   ├── package.json
│   │   ├── Dockerfile
│   │   └── src/
│   │       ├── index.ts
│   │       ├── config.ts
│   │       ├── routes/
│   │       │   ├── webhooks/sentry.ts, github.ts
│   │       │   ├── incidents.ts
│   │       │   └── health.ts
│   │       ├── lib/                    # Kafka, ClickHouse, Postgres, SQS clients
│   │       ├── detector/               # Incident Detector (deterministic)
│   │       ├── context-builder/        # Context Builder (deterministic SQS worker)
│   │       ├── dispatcher/             # Kafka→SQS routing
│   │       ├── lifecycle/              # Event-sourced status derivation
│   │       └── integrations/           # GitHub worker, Sentry ingest
│   │
│   ├── web/                            # Next.js Web App
│   │   ├── package.json
│   │   ├── Dockerfile
│   │   └── src/app/
│   │       ├── incidents/              # List + detail pages
│   │       └── components/             # Timeline, AgentOutput, etc.
│   │
│   └── agents/                         # Python Agent Workers
│       ├── pyproject.toml              # uv
│       ├── Dockerfile
│       └── src/
│           ├── common/                 # SQS consumer, Kafka producer, LLM+Langfuse
│           ├── rca/                    # RCA Agent
│           ├── fix/                    # Fix Agent
│           ├── instrumentation/        # Instrumentation Agent
│           └── evaluation/             # Evaluation Agent
│
├── scripts/
│   ├── setup.sh
│   ├── create-kafka-topics.sh
│   ├── seed-sentry-event.sh
│   └── replay-kafka.sh
│
└── tests/e2e/
```

**Tooling:** pnpm workspaces (TS), uv (Python), Docker Compose (infra), just (orchestration)

---

## Phase 1: Scaffolding + Infrastructure + Sentry Ingestion

**Goal:** Running local env where a Sentry webhook is received, written to ClickHouse, and queryable.

### Deliverables
- Root project: `pnpm-workspace.yaml`, `.gitignore`, `.env.example`, `justfile`
- `docker-compose.yml`: Kafka (KRaft mode), ClickHouse, Postgres (pgvector), LocalStack (SQS)
- `packages/shared`: TypeScript event type interfaces, topic/queue constants, idempotency key helper
- `packages/db`: ClickHouse migrations (raw_events table + 3 materialized views), Postgres migrations (tenants, incidents, integrations, pull_requests)
- `services/api`: Express server with `GET /health` and `POST /webhooks/sentry` (parses Sentry payload → ClickHouse insert)
- `scripts/create-kafka-topics.sh`, `scripts/seed-sentry-event.sh`

### Verify
- `just up` starts all containers
- `just migrate` runs all migrations
- `scripts/seed-sentry-event.sh` → row appears in ClickHouse `raw_events`
- Kafka topics listable, SQS queues listable

---

## Phase 2: Incident Detection + Dispatcher

**Goal:** Detector polls ClickHouse, emits `IncidentDetected` to Kafka. Dispatcher routes to SQS.

### Deliverables
- `services/api/src/detector/`: polling loop querying materialized views, spike/novelty detection rules, produces `IncidentDetected` to `debugging.timeline`, creates Postgres incident row
- `services/api/src/dispatcher/`: Kafka consumer on `debugging.timeline`, routes `IncidentDetected` → `context-builder-tasks` SQS queue, enforces idempotency
- `services/api/src/lifecycle/derive.ts`: pure function deriving incident status from event array
- `GET /incidents`, `GET /incidents/:id` API routes

### Verify
- Seed multiple Sentry events → Detector fires → `IncidentDetected` on Kafka
- Postgres `incidents` table has new row
- SQS `context-builder-tasks` has a message
- `GET /incidents` returns incident with status `detected`

---

## Phase 3: Context Builder + RCA Agent

**Goal:** Context assembled from ClickHouse evidence. RCA Agent reasons over it, emits `RootCauseProposed`.

### Deliverables
- `services/api/src/context-builder/`: SQS consumer for `context-builder-tasks`, queries ClickHouse for relevant errors/logs/deploys, optionally fetches code via GitHub API, emits `ContextBuilt`
- `services/agents/` Python project setup: `pyproject.toml` (uv), common SQS consumer base, Kafka producer, Pydantic models, LLM wrapper with Langfuse tracing
- `services/agents/src/rca/`: SQS consumer for `rca-tasks`, LLM prompt with structured context → hypothesis + confidence, emits `RootCauseProposed`
- Dispatcher routing: `ContextBuilt` → `rca-tasks`, `RootCauseProposed` (high confidence) → `fix-tasks`, (low confidence) → `instrumentation-tasks`
- Python agent Dockerfile added to docker-compose

### Verify
- Trigger incident → `ContextBuilt` on Kafka with structured context
- `RootCauseProposed` on Kafka with hypothesis + confidence
- Langfuse shows traced agent run

---

## Phase 4: Fix + Instrumentation Agents + GitHub Integration

**Goal:** Fix Agent proposes code changes. Instrumentation Agent proposes observability improvements. GitHub worker creates draft PRs.

### Deliverables
- `services/agents/src/fix/`: consumes `fix-tasks`, LLM produces file path + diff + explanation, emits `FixProposed`
- `services/agents/src/instrumentation/`: consumes `instrumentation-tasks`, proposes logging/tracing additions, emits `InstrumentationProposed`
- `services/api/src/integrations/github-worker.ts`: consumes `FixProposed`/`InstrumentationProposed` from Kafka, creates branch + draft PR via Octokit, records in Postgres, emits `FixApplied`
- `POST /webhooks/github`: receives PR merge events, emits `FixApplied`
- Dispatcher: `FixApplied` → `evaluation-tasks`

### Verify
- Full flow: Sentry webhook → incident → RCA → fix → draft PR on GitHub
- `pull_requests` table links incident to PR
- Instrumentation Agent produces meaningful suggestions for sparse-context incidents

---

## Phase 5: Evaluation Agent + Incident Resolution

**Goal:** Evaluation closes the loop. Incidents can be resolved. Lifecycle is complete.

### Deliverables
- `services/agents/src/evaluation/`: consumes `evaluation-tasks`, compares pre/post error rates from ClickHouse, LLM assessment, emits `EvaluationCompleted`
- Resolution logic in backend: `EvaluationCompleted` pass → emit `IncidentResolved`, fail → re-trigger RCA
- Suppression logic for known patterns → `IncidentSuppressed`
- `GET /incidents/:id/timeline` returns full event history
- Agent traceability: all outputs include `agent.name`, `agent.version`, Langfuse `trace_id`

### Verify
- Simulate post-fix improvement → `IncidentResolved` emitted
- `GET /incidents/:id` shows resolved status with full timeline
- Langfuse traces accessible for every agent step

---

## Phase 6: Web Dashboard

**Goal:** Next.js UI for incidents, timelines, and agent output inspection.

*Can start after Phase 2 with stubs; full verification requires Phase 5.*

### Deliverables
- Next.js App Router + Tailwind + shadcn/ui
- `/incidents` — list with status badges and filters
- `/incidents/[id]` — detail page: visual timeline, agent outputs inline, GitHub PR link, Langfuse trace links, missing context warnings
- BFF API routes proxying to backend

### Verify
- Incident list renders correctly
- Incident detail shows full timeline with all events
- Agent reasoning is readable, PR links work, traces are accessible

---

## Phase 7: E2E Tests + Polish

**Goal:** Validate all MVP success criteria. Harden error handling. Prove replay-safety.

### Deliverables
- E2E test suite: ingestion → detection → full lifecycle → replay-safety → SQS loss recovery
- `scripts/replay-kafka.sh`: reset offsets, replay, verify identical derived state
- DLQs for SQS failures, retry with backoff, graceful shutdown
- Health checks for all Docker services
- README with setup instructions

### MVP Success Criteria Checklist
- [ ] Real Sentry error ingested
- [ ] Incident created and analyzed by agents
- [ ] Missing context explicitly identified
- [ ] Draft PR generated
- [ ] Agent reasoning traceable and inspectable

---

## Phase Dependencies

```
Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5 → Phase 7
                                                ↗
                       Phase 6 (parallel from Phase 2 onward)
```
