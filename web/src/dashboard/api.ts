// REST reads of Aura's long-term memory (agent/aura/main.py /memory/*): Neo4j topology, Qdrant incidents.
import { useCallback, useEffect, useState } from 'react'

export async function getJson<T>(path: string, token: string): Promise<T> {
  const r = await fetch(path, { headers: { 'x-aura-token': token } })
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.detail || `${r.status} ${r.statusText}`)
  return r.json()
}

/** Fetches `path` (null = skip) and refetches whenever `path` or `version` changes. */
export function useGet<T>(path: string | null, token: string, version: unknown = 0) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!path) return
    let live = true
    setLoading(true)
    getJson<T>(path, token)
      .then((d) => { if (live) { setData(d); setError(null) } })
      .catch((e) => { if (live) setError(String(e.message || e)) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [path, token, version, tick])

  return { data, error, loading, reload: useCallback(() => setTick((t) => t + 1), []) }
}

export type Topology = {
  nodes: { name: string; tier?: string; incidents: number; confirmed: number; deployments: number }[]
  edges: { source: string; target: string }[]
}

export type ServiceDetail = {
  name: string
  incidents: { id: string; root_cause_type: string; confirmed: boolean; timestamp: string; action?: string; commit?: string }[]
  deployments: { commit: string; timestamp: string; author?: string; message?: string; caused: string[] }[]
  frequency: { root_cause_type: string; times: number; confirmed: number }[]
  impact: { name: string; tier?: string }[]
}

export type Outcome = 'confirmed' | 'rejected' | 'inconclusive'

export type Memory = {
  incident_id: string
  service: string
  root_cause_type: string
  resolved_by: string
  confirmed: boolean
  inconclusive?: boolean
  timestamp: string
  text: string
  outcome: Outcome
  similarity?: number
}

export type Runbook = { id: string; title: string; text: string; similarity: number }

export type SearchResult = { incidents: Memory[]; runbooks: Runbook[] }
