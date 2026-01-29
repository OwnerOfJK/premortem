export interface AgentMeta {
  name: string;
  version: string;
}

export interface BaseTimelineEvent {
  time: string;
  tenant_id: string;
  incident_id: string;
  event_type: string;
  agent?: AgentMeta;
}

export interface IncidentDetectedPayload {
  error_signature: string;
  service: string;
  error_type: string;
  error_value: string;
  spike_count: number;
  window_minutes: number;
}

export interface IncidentDetectedEvent extends BaseTimelineEvent {
  event_type: "IncidentDetected";
  payload: IncidentDetectedPayload;
}

export interface ContextBuiltPayload {
  error_count: number;
  time_range_minutes: number;
  services: string[];
  has_deploy_info: boolean;
  has_code_context: boolean;
  context_summary: string;
}

export interface ContextBuiltEvent extends BaseTimelineEvent {
  event_type: "ContextBuilt";
  payload: ContextBuiltPayload;
}

export interface RootCauseProposedPayload {
  hypothesis: string;
  confidence: number;
  evidence_refs: string[];
}

export interface RootCauseProposedEvent extends BaseTimelineEvent {
  event_type: "RootCauseProposed";
  payload: RootCauseProposedPayload;
}

export interface FixProposedPayload {
  description: string;
  files: Array<{ path: string; diff: string }>;
  fix_type: "code" | "config" | "rollback";
}

export interface FixProposedEvent extends BaseTimelineEvent {
  event_type: "FixProposed";
  payload: FixProposedPayload;
}

export interface FixAppliedPayload {
  pr_url: string;
  pr_number: number;
  merge_sha?: string;
}

export interface FixAppliedEvent extends BaseTimelineEvent {
  event_type: "FixApplied";
  payload: FixAppliedPayload;
}

export interface InstrumentationProposedPayload {
  suggestions: Array<{
    type: "log" | "metric" | "trace";
    file: string;
    description: string;
  }>;
}

export interface InstrumentationProposedEvent extends BaseTimelineEvent {
  event_type: "InstrumentationProposed";
  payload: InstrumentationProposedPayload;
}

export interface EvaluationCompletedPayload {
  pass: boolean;
  pre_error_rate: number;
  post_error_rate: number;
  assessment: string;
}

export interface EvaluationCompletedEvent extends BaseTimelineEvent {
  event_type: "EvaluationCompleted";
  payload: EvaluationCompletedPayload;
}

export interface IncidentResolvedPayload {
  resolution_summary: string;
}

export interface IncidentResolvedEvent extends BaseTimelineEvent {
  event_type: "IncidentResolved";
  payload: IncidentResolvedPayload;
}

export interface IncidentSuppressedPayload {
  reason: string;
  matching_pattern?: string;
}

export interface IncidentSuppressedEvent extends BaseTimelineEvent {
  event_type: "IncidentSuppressed";
  payload: IncidentSuppressedPayload;
}

export type TimelineEvent =
  | IncidentDetectedEvent
  | ContextBuiltEvent
  | RootCauseProposedEvent
  | FixProposedEvent
  | FixAppliedEvent
  | InstrumentationProposedEvent
  | EvaluationCompletedEvent
  | IncidentResolvedEvent
  | IncidentSuppressedEvent;

export type TimelineEventType = TimelineEvent["event_type"];
