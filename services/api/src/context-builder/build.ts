import {
  type IncidentDetectedEvent,
  type ContextBuiltEvent,
} from "@premortem/shared";
import { queryContextData } from "./queries.js";

export async function buildContext(
  event: IncidentDetectedEvent,
): Promise<ContextBuiltEvent> {
  const { tenant_id, incident_id, payload } = event;
  const contextData = await queryContextData(tenant_id, payload.error_signature);

  const services = [
    ...new Set(contextData.errorSamples.map((s) => s.service)),
  ];

  // Build structured context summary for the RCA agent
  const lines: string[] = [
    `## Error Summary`,
    `- Type: ${payload.error_type}`,
    `- Message: ${payload.error_value}`,
    `- Service(s): ${services.join(", ")}`,
    `- Total occurrences (last 60 min): ${contextData.errorCount}`,
    `- Spike count (detection window): ${payload.spike_count}`,
    "",
  ];

  if (contextData.deployHashes.length > 0) {
    lines.push(`## Recent Deploys`);
    for (const hash of contextData.deployHashes) {
      lines.push(`- ${hash}`);
    }
    lines.push("");
  }

  if (contextData.errorSamples.length > 0) {
    lines.push(`## Sample Stacktraces (${contextData.errorSamples.length})`);
    for (const sample of contextData.errorSamples.slice(0, 5)) {
      lines.push(`### ${sample.event_id} (${sample.event_timestamp})`);
      // Include top frames of stacktrace
      const frames = sample.stacktrace
        .split("\n")
        .filter((l) => l.trim())
        .slice(0, 10);
      lines.push("```");
      lines.push(...frames);
      lines.push("```");
      lines.push("");
    }
  }

  const contextSummary = lines.join("\n");

  return {
    time: new Date().toISOString(),
    tenant_id,
    incident_id,
    event_type: "ContextBuilt",
    payload: {
      error_count: contextData.errorCount,
      time_range_minutes: 60,
      services,
      has_deploy_info: contextData.deployHashes.length > 0,
      has_code_context: false,
      context_summary: contextSummary,
    },
  };
}
