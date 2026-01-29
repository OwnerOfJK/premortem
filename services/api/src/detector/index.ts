import { detectSpikes } from "./detect.js";
import { config } from "../config.js";

let intervalHandle: ReturnType<typeof setInterval> | null = null;

export function startDetector(): void {
  console.log(
    `Starting detector (poll every ${config.DETECTOR_POLL_INTERVAL_MS}ms, threshold=${config.DETECTOR_SPIKE_THRESHOLD})`,
  );

  // Run immediately on start, then on interval
  detectSpikes().catch((err) =>
    console.error("Detector tick failed:", err),
  );

  intervalHandle = setInterval(() => {
    detectSpikes().catch((err) =>
      console.error("Detector tick failed:", err),
    );
  }, config.DETECTOR_POLL_INTERVAL_MS);
}

export function stopDetector(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    console.log("Detector stopped");
  }
}
