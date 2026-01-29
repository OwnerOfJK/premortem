import express from "express";
import { config } from "./config.js";
import healthRouter from "./routes/health.js";
import sentryRouter from "./routes/webhooks/sentry.js";
import incidentsRouter from "./routes/incidents.js";
import { startDetector, stopDetector } from "./detector/index.js";
import { startDispatcher, stopDispatcher } from "./dispatcher/index.js";
import { disconnectProducer } from "./lib/kafka.js";
import { db } from "./lib/postgres.js";

const app = express();

app.use(express.json({ limit: "5mb" }));

app.use(healthRouter);
app.use(sentryRouter);
app.use(incidentsRouter);

const server = app.listen(config.API_PORT, () => {
  console.log(`API listening on port ${config.API_PORT}`);

  startDetector();
  startDispatcherWithRetry();
});

let dispatcherStopping = false;

async function startDispatcherWithRetry(
  maxRetries = 10,
  delayMs = 3000,
): Promise<void> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    if (dispatcherStopping) return;
    try {
      await startDispatcher();
      return;
    } catch (err) {
      console.error(
        `Dispatcher start attempt ${attempt}/${maxRetries} failed:`,
        err instanceof Error ? err.message : err,
      );
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }
  console.error("Dispatcher failed to start after all retries");
}

async function shutdown(): Promise<void> {
  dispatcherStopping = true;
  console.log("Shutting down gracefully...");
  stopDetector();
  await stopDispatcher();
  await disconnectProducer();
  await db.destroy();
  server.close(() => {
    console.log("Server closed");
    process.exit(0);
  });
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
