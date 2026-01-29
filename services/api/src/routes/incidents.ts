import { Router, type Router as RouterType } from "express";
import { getIncidents, getIncidentById } from "../lib/postgres.js";

const router: RouterType = Router();

router.get("/incidents", async (req, res) => {
  try {
    const { status, tenant_id } = req.query;
    const incidents = await getIncidents({
      status: typeof status === "string" ? status : undefined,
      tenant_id: typeof tenant_id === "string" ? tenant_id : undefined,
    });
    res.json(incidents);
  } catch (err) {
    console.error("Failed to list incidents:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/incidents/:id", async (req, res) => {
  try {
    const incident = await getIncidentById(req.params.id);
    if (!incident) {
      res.status(404).json({ error: "Incident not found" });
      return;
    }
    res.json(incident);
  } catch (err) {
    console.error("Failed to get incident:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
