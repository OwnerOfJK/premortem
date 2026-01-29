import { createHash } from "node:crypto";
import { Router, type Router as RouterType } from "express";
import { newEventId } from "@premortem/shared";
import { insertRawEvent } from "../../lib/clickhouse.js";
import type { RawEventRow } from "../../lib/clickhouse.js";

const router: RouterType = Router();

const DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000001";

interface SentryFrame {
  filename?: string;
  function?: string;
  lineno?: number;
  colno?: number;
  in_app?: boolean;
  abs_path?: string;
  context_line?: string;
}

interface SentryException {
  type?: string;
  value?: string;
  stacktrace?: {
    frames?: SentryFrame[];
  };
}

function computeErrorSignature(
  errorType: string,
  frames: SentryFrame[],
): string {
  const topInAppFrame = [...frames].reverse().find((f) => f.in_app);
  const frame = topInAppFrame || frames[frames.length - 1];
  const input = [
    errorType,
    frame?.filename || "",
    frame?.function || "",
    String(frame?.lineno || 0),
  ].join(":");
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

router.post("/webhooks/sentry", async (req, res) => {
  try {
    const body = req.body;

    // Sentry issue alert webhook format
    const eventData = body.event || body.data?.event || body;
    const exception =
      eventData?.exception?.values?.[0] as SentryException | undefined;

    const errorType = exception?.type || eventData?.title || "UnknownError";
    const errorValue =
      exception?.value || eventData?.message || eventData?.culprit || "";
    const frames = exception?.stacktrace?.frames || [];

    const errorSignature = computeErrorSignature(errorType, frames);

    const serviceTag = eventData?.tags?.find(
      (t: [string, string] | { key: string; value: string }) =>
        (Array.isArray(t) ? t[0] : t.key) === "service",
    );
    const service =
      (serviceTag
        ? Array.isArray(serviceTag)
          ? serviceTag[1]
          : serviceTag.value
        : null) ||
      eventData?.project ||
      body.project?.slug ||
      "unknown";

    const platform = eventData?.platform || "";
    const environment =
      eventData?.environment || eventData?.tags?.environment || "production";
    const level = eventData?.level || "error";

    const tagsMap: Record<string, string> = {};
    if (Array.isArray(eventData?.tags)) {
      for (const tag of eventData.tags) {
        if (Array.isArray(tag)) {
          tagsMap[tag[0]] = tag[1];
        } else if (tag && typeof tag === "object") {
          tagsMap[tag.key] = tag.value;
        }
      }
    }

    const row: RawEventRow = {
      event_id: newEventId(),
      tenant_id: DEFAULT_TENANT_ID,
      source: "sentry",
      error_type: errorType,
      error_value: errorValue,
      error_signature: errorSignature,
      level,
      service,
      environment,
      platform,
      stacktrace: JSON.stringify(frames),
      tags: tagsMap,
      raw_payload: JSON.stringify(body),
      deploy_hash: tagsMap["release"] || "",
      event_timestamp: eventData?.timestamp
        ? new Date(
            typeof eventData.timestamp === "number"
              ? eventData.timestamp * 1000
              : eventData.timestamp,
          ).toISOString()
        : new Date().toISOString(),
    };

    await insertRawEvent(row);

    console.log(
      `Ingested Sentry event: ${row.event_id} sig=${row.error_signature} service=${row.service}`,
    );

    res.status(200).json({
      ok: true,
      event_id: row.event_id,
      error_signature: row.error_signature,
    });
  } catch (err) {
    console.error("Sentry webhook error:", err);
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : "unknown",
    });
  }
});

export default router;
