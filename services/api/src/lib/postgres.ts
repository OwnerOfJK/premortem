import pg from "pg";
import { Kysely, PostgresDialect, type Selectable } from "kysely";
import { config } from "../config.js";
import type { Database } from "./db-types.js";

export const db = new Kysely<Database>({
  dialect: new PostgresDialect({
    pool: new pg.Pool({
      host: config.POSTGRES_HOST,
      port: config.POSTGRES_PORT,
      database: config.POSTGRES_DB,
      user: config.POSTGRES_USER,
      password: config.POSTGRES_PASSWORD,
    }),
  }),
});

export type IncidentRow = Selectable<Database["incidents"]>;

export async function insertIncident(incident: {
  incident_id: string;
  tenant_id: string;
  service: string;
  error_signature: string;
  error_type: string;
  error_value: string;
}): Promise<IncidentRow> {
  return db.insertInto("incidents").values(incident).returningAll().executeTakeFirstOrThrow();
}

export async function findOpenIncident(
  tenantId: string,
  errorSignature: string,
): Promise<IncidentRow | null> {
  const row = await db
    .selectFrom("incidents")
    .selectAll()
    .where("tenant_id", "=", tenantId)
    .where("error_signature", "=", errorSignature)
    .where("status", "not in", ["resolved", "suppressed"])
    .limit(1)
    .executeTakeFirst();
  return row ?? null;
}

export async function getIncidents(filters: {
  tenant_id?: string;
  status?: string;
}): Promise<IncidentRow[]> {
  let query = db.selectFrom("incidents").selectAll();

  if (filters.tenant_id) {
    query = query.where("tenant_id", "=", filters.tenant_id);
  }
  if (filters.status) {
    query = query.where("status", "=", filters.status);
  }

  return query.orderBy("created_at", "desc").execute();
}

export async function getIncidentById(
  incidentId: string,
): Promise<IncidentRow | null> {
  const row = await db
    .selectFrom("incidents")
    .selectAll()
    .where("incident_id", "=", incidentId)
    .executeTakeFirst();
  return row ?? null;
}