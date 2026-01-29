# Agentic Debugging Platform (v1)

## 1. Problem

Modern “vibe-coded” applications ship extremely fast, often prioritizing velocity over observability. When failures occur, developers face fragmented signals (logs, stack traces, provider dashboards), missing instrumentation, and reliance on tribal knowledge. Debugging becomes slow, manual, and expensive—especially for small teams.

---

## 2. Solution

An **agentic debugging platform** that acts as an AI on-call engineer.

The system reasons over existing evidence, diagnoses incidents, proposes fixes, and explicitly identifies missing observability. Each incident improves the system: bugs are fixed, instrumentation gaps are patched, and future incidents become cheaper to debug.

The platform does **not** replace observability tools; it coordinates and reasons *on top of them*.

---

## 3. Core Principles

* **ClickHouse = evidence** (what happened in the app)
* **Kafka = temporal truth** (what happened in the debugging process)
* **SQS = work distribution** (what should be executed)
* **Agents = LLM-based reasoning only** (no side effects)
* **Deterministic components = rule-based backend logic**
* **Integrations = side effects** (emit facts only)
* **Dispatcher = glue, not intelligence**

Kafka is the canonical history. SQS is disposable. The system must be replay-safe.

---

## 4. High-Level Architecture

### Data Stores

* **ClickHouse**: raw logs, stack traces, request metadata, and derived aggregates
* **Postgres**: system state (tenants, incidents, integrations, PRs)
* **pgvector**: semantic memory (derived, non-canonical)

### Services

* **Next.js Web App**: incident dashboards and agent outputs
* **Node.js API (TypeScript, Express)**: deterministic orchestration, lifecycle derivation, integrations
* **Python Agent Workers**: independent workers per agent type (LLM reasoning only)

---

## 5. ClickHouse — Evidence Store

### Stored Data

* Application logs (stdout / stderr)
* Stack traces
* Request metadata (service, route, deploy hash, timestamp)

### Evidence Ingestion

The platform **does not own log collection**.

Evidence is ingested into ClickHouse via existing observability pipelines and integrations, such as:

* Log shippers (e.g. Vector, Fluent Bit)
* OpenTelemetry collectors (traces, spans)
* Error providers (e.g. Sentry exports)

The platform consumes this evidence for detection and analysis but does not control ingestion.

### Key Materialized Views

* Error frequency: `(service, error_signature, time_bucket) → count`
* Error novelty: `(service, error_signature, deploy_hash) → first_seen_at`
* Error rate: `(service, time_bucket) → total_requests, error_requests`

### Used By

* Incident Detector
* Context Builder

---

## 6. Deterministic Components vs Agents

### Deterministic Components (Backend)

The following components are **not agents**. They are deterministic, rule-based, and implemented as part of the Node.js backend. They must behave identically under replay.

* **Incident Detector**

  * Detects anomalies from ClickHouse materialized views
  * Emits `IncidentDetected`

* **Context Builder**

  * Builds bounded, structured context (logs, deploys, code refs)
  * Executed asynchronously as a deterministic backend worker consuming from the `context-builder-tasks` SQS queue
  * Deterministic under replay despite asynchronous execution
  * Emits `ContextBuilt`

---

### Agents (LLM-based Reasoning Only)

Agents are **pure LLM-based reasoning components**. They never mutate system state or call external systems.

* **RCA Agent**

  * Proposes root-cause hypotheses with confidence
  * Emits `RootCauseProposed`

* **Fix Agent**

  * Proposes remediations (code/config)
  * Emits `FixProposed`

* **Instrumentation Agent**

  * Proposes minimal observability improvements
  * Emits `InstrumentationProposed`

* **Evaluation Agent (required)**

  * Assesses root-cause accuracy and fix effectiveness using post-fix evidence
  * Emits an evaluation result event (e.g. `EvaluationCompleted`) containing post-fix metrics and pass/fail outcome

Deterministic backend logic (or explicit human confirmation) is responsible for emitting `IncidentResolved` based on evaluation results.

---

## 7. Kafka — Debugging Control Plane

Kafka models the **debugging timeline**, not raw telemetry.

### Topic: `debugging.timeline`

Canonical, immutable record of incident evolution.

**Event shape (example)**

```json
{
  "time": "2026-01-28T12:34:56Z",
  "tenant_id": "tenant_1",
  "incident_id": "inc_123",
  "event_type": "RootCauseProposed",
  "payload": {
    "hypothesis": "Missing JWT_SECRET",
    "confidence": 0.87
  },
  "agent": {
    "name": "rca-agent",
    "version": "0.3.1"
  }
}
```

### Additional Topics

* `debugging.internal` — platform operational events
* `debugging.evaluation` — derived effectiveness assessments

All Kafka events **must include `tenant_id`**.

---

## 8. Dispatcher

A stateless service that:

* Consumes Kafka events
* Enqueues SQS tasks deterministically
* Never reasons or mutates facts

### Idempotency

* Enforced at the dispatcher → SQS boundary
* Idempotency key:
  `(tenant_id, incident_id, event_type, agent_version)`

The system must support replaying Kafka from offset 0 and deterministically recreating all required work.

---

## 9. SQS — Work Queues

* `context-builder-tasks`

  * Triggered by `IncidentDetected`

* `rca-tasks`

  * Triggered by `ContextBuilt`

* `fix-tasks`

  * Triggered by `RootCauseProposed` (confidence ≥ threshold)

* `instrumentation-tasks`

  * Triggered by low-confidence or missing-signal cases

* `evaluation-tasks`

  * Triggered by `FixApplied` or on schedule

Tasks are idempotent and disposable.

---

## 10. Integrations & Side Effects

All side effects are performed by **Integration Workers**, never by agents.

Examples:

* Creating GitHub pull requests
* Applying configuration changes

Integration Workers consume agent output events and emit **factual follow-up events**:

* **`FixProposed`**: emitted when a GitHub integration worker creates a pull request
* **`FixApplied`**: emitted when a pull request is merged — either automatically or by explicit human action

In all cases, these events represent external facts, not agent decisions.

---

## 11. Incident Lifecycle

Incident lifecycle is derived **exclusively from the presence and ordering of Kafka events**. There is no stored incident state machine.

All lifecycle events represent **facts** derived from system evidence or explicit human actions.

### Valid Lifecycle Progression

The lifecycle below represents a **typical happy path**. In practice, investigation may involve repeated cycles of context building, root-cause analysis, fix proposals, and instrumentation proposals.

These loops are represented by **repeated emission of progress events** and do not require additional lifecycle states.

```
IncidentDetected → ContextBuilt → RootCauseProposed → FixProposed → FixApplied → IncidentResolved
                         ↓
                  IncidentSuppressed
```

### Lifecycle Events (Facts)

* `IncidentDetected`
* `ContextBuilt`
* `RootCauseProposed`
* `FixProposed`
* `FixApplied`
* `IncidentResolved`
* `IncidentSuppressed`

Derived views (e.g. "current status") are computed by replaying events under deterministic rules. This guarantees correctness under replay, retries, and out-of-order delivery.

---

## 12. Human Interaction

* Manual incident creation emits `IncidentDetected`
* GitHub merges emit `FixApplied`

Humans emit **facts**, not commands.

---

## 13. MVP Scope (v1)

### Included

* Single-tenant deployment with tenant-aware data model (`tenant_id` required)
* GitHub + Sentry integrations
* ClickHouse-backed incident detection
* End-to-end flow: error → incident → RCA → fix proposal → evaluation
* Langfuse tracing for all agent runs

### Excluded

* PagerDuty replacement
* Auto-remediation
* Broad integration surface

---

## 14. Invariants (Must Hold)

* Kafka is the sole canonical history
* ClickHouse stores evidence, not truth
* SQS may lose messages without violating correctness
* Agents never cause side effects
* All system behavior is replay-safe

---

This document is the **single source of truth** for implementation and AI coding assistants.
