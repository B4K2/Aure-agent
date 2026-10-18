// Shapes of what the agent server (agent/aura/main.py) pushes over /ws.

export type Beat = {
  at: string
  health: { up: boolean; status: number | string; latency_s?: number | null }
  rps?: number
  p95?: number
  err?: number
  rss_mb?: number
  lag?: number
  pool_waiting?: number
  db: { up?: boolean; sessions?: number; max?: number; lock_waits?: number }
  open: number
}

export type Anomaly = {
  id: string
  signal_type: string
  metric_name?: string
  value?: number
  baseline?: number
  deviation_sigma?: number
  detected_at: string
  raw_excerpt: string
}

export type Action = { type: string; target: string; params?: Record<string, unknown> }

export type Rca = {
  hypothesis: string
  root_cause_type: string
  evidence: { source: string; detail: string }[]
  llm_confidence: number
  calibrated_confidence: number
  confidence_adjustments: string[]
  proposed_action: Action
  reasoning_trace: string
  low_confidence: boolean
}

export type AuditEntry = { timestamp: string; node: string; action?: string; output_summary: string }

export type Incident = {
  incident_id: string
  status: string
  opened_at?: string
  // summary rows (hello / list) carry these instead of the full objects
  anomalies?: number
  hypothesis?: string
  confidence?: number
  action?: Action
  // full rows
  anomalies_detected?: Anomaly[]
  rca?: Rca
  human_decision?: string
  human_note?: string
  execution_result?: { resolved?: boolean; message?: string; logs?: string[] }
  audit_trail?: AuditEntry[]
}

export type FeedItem = { id: number; at: string; kind: 'incident' | 'anomaly' | 'stage' | 'closed' | 'error' | 'system'; incidentId?: string; text: string }

export type ChatMsg = { id: number; role: 'user' | 'aura' | 'tool'; text: string }

export type AuraEvent = { type: string; at?: string; [k: string]: any } // eslint-disable-line @typescript-eslint/no-explicit-any

export const ADVISORY = new Set(['investigate_further', 'scale'])
export const CLOSED = new Set(['resolved', 'rejected', 'unresolved'])
