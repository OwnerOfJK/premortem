import express from "express";
import { config } from "./config.js";
import healthRouter from "./routes/health.js";
import sentryRouter from "./routes/webhooks/sentry.js";

const app = express();

app.use(express.json({ limit: "5mb" }));

app.use(healthRouter);
app.use(sentryRouter);

app.listen(config.API_PORT, () => {
  console.log(`API listening on port ${config.API_PORT}`);
});
