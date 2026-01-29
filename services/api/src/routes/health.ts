import { Router, type Router as RouterType } from "express";
import { clickhouse } from "../lib/clickhouse.js";

const router: RouterType = Router();

router.get("/health", async (_req, res) => {
  try {
    await clickhouse.ping();
    res.json({ status: "ok", clickhouse: "connected" });
  } catch (err) {
    res.status(503).json({
      status: "degraded",
      clickhouse: "disconnected",
      error: err instanceof Error ? err.message : "unknown",
    });
  }
});

export default router;
