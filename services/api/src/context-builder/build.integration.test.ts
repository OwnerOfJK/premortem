import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@clickhouse/client";
import { newEventId } from "@premortem/shared";
import type { IncidentDetectedEvent } from "@premortem/shared";
import { buildContext } from "./build.js";

/*
 * Integration test: requires `just up && just migrate`
 * Exercises the buildContext function:
 *   1. Seed ClickHouse with raw error events (with deploy hashes and stacktraces)
 *   2. Call buildContext() with an IncidentDetectedEvent
 *   3. Verify the returned ContextBuiltEvent has correct structure and summary
 */

const TENANT_ID = "00000000-0000-0000-0000-000000000001";
const SERVICE = "payments-service";
const ERROR_SIGNATURE = `ctx_build_test_${Date.now().toString(16)}`;
const ERROR_TYPE = "NullPointerException";
const ERROR_VALUE = "Cannot read property 'id' of undefined";
const DEPLOY_HASH = "abc123def";
const STACKTRACE = [
  "Error: Cannot read property 'id' of undefined",
  "    at processPayment (src/payments/process.ts:42:15)",
  "    at handleRequest (src/server/handler.ts:18:9)",
  "    at Router.dispatch (node_modules/express/lib/router.js:120:12)",
].join("\n");

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST || "http://localhost:8123",
  database: process.env.CLICKHOUSE_DB || "premortem",
  username: process.env.CLICKHOUSE_USER || "premortem_user",
  password: process.env.CLICKHOUSE_PASSWORD || "premortem_pw",
});

describe("buildContext integration", () => {
  beforeAll(async () => {
    // Seed ClickHouse with error events
    const rows = Array.from({ length: 8 }, (_, i) => ({
      event_id: newEventId(),
      tenant_id: TENANT_ID,
      source: "sentry",
      error_type: ERROR_TYPE,
      error_value: ERROR_VALUE,
      error_signature: ERROR_SIGNATURE,
      level: "error",
      service: SERVICE,
      environment: "production",
      platform: "node",
      stacktrace: STACKTRACE,
      tags: {},
      raw_payload: "{}",
      deploy_hash: i < 5 ? DEPLOY_HASH : "", // some with deploy, some without
      event_timestamp: new Date().toISOString(),
    }));

    await clickhouse.insert({
      table: "raw_events",
      values: rows,
      format: "JSONEachRow",
      clickhouse_settings: {
        date_time_input_format: "best_effort",
        async_insert: 0,
        wait_for_async_insert: 1,
      },
    });

    // Give MV a moment to populate
    await sleep(1000);
  });

  afterAll(async () => {
    await clickhouse.close();
  });

  it("builds context with error samples, count, and deploy info", async () => {
    const incidentEvent: IncidentDetectedEvent = {
      time: new Date().toISOString(),
      tenant_id: TENANT_ID,
      incident_id: "inc_test_ctx_build",
      event_type: "IncidentDetected",
      payload: {
        error_signature: ERROR_SIGNATURE,
        service: SERVICE,
        error_type: ERROR_TYPE,
        error_value: ERROR_VALUE,
        spike_count: 8,
        window_minutes: 5,
      },
    };

    const result = await buildContext(incidentEvent);

    // Verify event structure
    expect(result.event_type).toBe("ContextBuilt");
    expect(result.tenant_id).toBe(TENANT_ID);
    expect(result.incident_id).toBe("inc_test_ctx_build");
    expect(result.time).toBeDefined();

    // Verify payload
    expect(result.payload.error_count).toBeGreaterThanOrEqual(8);
    expect(result.payload.time_range_minutes).toBe(60);
    expect(result.payload.services).toContain(SERVICE);
    expect(result.payload.has_deploy_info).toBe(true);
    expect(result.payload.has_code_context).toBe(false);

    // Verify context summary content
    const summary = result.payload.context_summary;
    expect(summary).toContain("## Error Summary");
    expect(summary).toContain(ERROR_TYPE);
    expect(summary).toContain(ERROR_VALUE);
    expect(summary).toContain(SERVICE);
    expect(summary).toContain("## Recent Deploys");
    expect(summary).toContain(DEPLOY_HASH);
    expect(summary).toContain("## Sample Stacktraces");
    expect(summary).toContain("processPayment");
  });

  it("handles events with no deploy info gracefully", async () => {
    const noDeploySig = `ctx_nodeploy_${Date.now().toString(16)}`;

    // Seed events without deploy hashes
    const rows = Array.from({ length: 3 }, () => ({
      event_id: newEventId(),
      tenant_id: TENANT_ID,
      source: "sentry",
      error_type: "TypeError",
      error_value: "x is not a function",
      error_signature: noDeploySig,
      level: "error",
      service: SERVICE,
      environment: "production",
      platform: "node",
      stacktrace: "Error: x is not a function\n    at foo (bar.ts:1:1)",
      tags: {},
      raw_payload: "{}",
      deploy_hash: "",
      event_timestamp: new Date().toISOString(),
    }));

    await clickhouse.insert({
      table: "raw_events",
      values: rows,
      format: "JSONEachRow",
      clickhouse_settings: {
        date_time_input_format: "best_effort",
        async_insert: 0,
        wait_for_async_insert: 1,
      },
    });

    await sleep(1000);

    const result = await buildContext({
      time: new Date().toISOString(),
      tenant_id: TENANT_ID,
      incident_id: "inc_no_deploy",
      event_type: "IncidentDetected",
      payload: {
        error_signature: noDeploySig,
        service: SERVICE,
        error_type: "TypeError",
        error_value: "x is not a function",
        spike_count: 3,
        window_minutes: 5,
      },
    });

    expect(result.payload.has_deploy_info).toBe(false);
    expect(result.payload.context_summary).not.toContain("## Recent Deploys");
  });
});

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
