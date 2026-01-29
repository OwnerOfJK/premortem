import { clickhouse } from "../lib/clickhouse.js";
import { findOpenIncident, insertIncident } from "../lib/postgres.js";
import { produceTimelineEvent } from "../lib/kafka.js";
import { newIncidentId } from "@premortem/shared";
import { config } from "../config.js";
import type { IncidentDetectedEvent } from "@premortem/shared";

interface SpikeRow {
  tenant_id: string;
  service: string;
  error_signature: string;
  total: string;
}

interface ErrorDetailRow {
  error_type: string;
  error_value: string;
}

export async function detectSpikes(): Promise<void> {
  const threshold = config.DETECTOR_SPIKE_THRESHOLD;

  const result = await clickhouse.query({
    query: `
      SELECT tenant_id, service, error_signature, sum(event_count) as total
      FROM error_frequency FINAL
      WHERE time_bucket >= now() - INTERVAL 5 MINUTE
      GROUP BY tenant_id, service, error_signature
      HAVING total >= {threshold:UInt64}
    `,
    query_params: { threshold },
    format: "JSONEachRow",
  });

  const spikes = await result.json<SpikeRow>();

  for (const spike of spikes) {
    const existing = await findOpenIncident(
      spike.tenant_id,
      spike.error_signature,
    );
    if (existing) continue;

    // Fetch error details from raw_events
    const detailResult = await clickhouse.query({
      query: `
        SELECT error_type, error_value
        FROM raw_events
        WHERE tenant_id = {tenant_id:String}
          AND error_signature = {error_signature:String}
        ORDER BY event_timestamp DESC
        LIMIT 1
      `,
      query_params: {
        tenant_id: spike.tenant_id,
        error_signature: spike.error_signature,
      },
      format: "JSONEachRow",
    });

    const details = await detailResult.json<ErrorDetailRow>();
    const errorType = details[0]?.error_type ?? "Unknown";
    const errorValue = details[0]?.error_value ?? "";

    const incidentId = newIncidentId();

    await insertIncident({
      incident_id: incidentId,
      tenant_id: spike.tenant_id,
      service: spike.service,
      error_signature: spike.error_signature,
      error_type: errorType,
      error_value: errorValue,
    });

    const event: IncidentDetectedEvent = {
      time: new Date().toISOString(),
      tenant_id: spike.tenant_id,
      incident_id: incidentId,
      event_type: "IncidentDetected",
      payload: {
        error_signature: spike.error_signature,
        service: spike.service,
        error_type: errorType,
        error_value: errorValue,
        spike_count: Number(spike.total),
        window_minutes: 5,
      },
    };

    await produceTimelineEvent(event);
    console.log(
      `Incident detected: ${incidentId} (${spike.service}/${spike.error_signature}, count=${spike.total})`,
    );
  }
}
