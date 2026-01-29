import { randomUUID } from "node:crypto";

export function newEventId(): string {
  return `evt_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

export function newIncidentId(): string {
  return `inc_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}
