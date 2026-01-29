import { randomUUID } from "node:crypto";

export function newEventId(): string {
  return `evt_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}
