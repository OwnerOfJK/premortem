import type { Generated } from "kysely";

export interface TenantsTable {
  id: Generated<string>;
  name: string;
  slug: string;
  config: Generated<Record<string, unknown>>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface IncidentsTable {
  id: Generated<string>;
  incident_id: string;
  tenant_id: string;
  service: string;
  error_signature: string;
  error_type: Generated<string>;
  error_value: Generated<string>;
  status: Generated<string>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface IntegrationsTable {
  id: Generated<string>;
  tenant_id: string;
  provider: string;
  config: Generated<Record<string, unknown>>;
  webhook_secret: string | null;
  enabled: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface PullRequestsTable {
  id: Generated<string>;
  incident_id: string;
  tenant_id: string;
  provider: Generated<string>;
  repo: string;
  pr_number: number;
  pr_url: string;
  branch: Generated<string>;
  status: Generated<string>;
  merged_at: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface Database {
  tenants: TenantsTable;
  incidents: IncidentsTable;
  integrations: IntegrationsTable;
  pull_requests: PullRequestsTable;
}
