export function idempotencyKey(
  tenantId: string,
  incidentId: string,
  eventType: string,
  agentVersion?: string,
): string {
  const parts = [tenantId, incidentId, eventType];
  if (agentVersion) parts.push(agentVersion);
  return parts.join(":");
}
