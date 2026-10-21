// One WebSocket to the agent server, the same protocol aura-cli uses (aura-cli/src/backend.ts).
// Every client gets every broadcast, so approvals from the CLI show up here and vice versa.
import { useCallback, useEffect, useRef, useState } from 'react'
import { GENERAL, type AuraEvent, type Beat, type ChatMsg, type FeedItem, type Incident } from './types'

export type Status = 'connecting' | 'connected' | 'reconnecting' | 'bad token'

export function useAura(token: string | null) {
  const [status, setStatus] = useState<Status>('connecting')
  const [watching, setWatching] = useState('')
  const [service, setService] = useState('void-app') // the watched service, as named in the topology
  const [beats, setBeats] = useState<Beat[]>([])
  const [incidents, setIncidents] = useState<Record<string, Incident>>({})
  const [stages, setStages] = useState<Record<string, string>>({}) // incident → live stage
  const [feed, setFeed] = useState<FeedItem[]>([])
  // chat threads: one per incident id, '' = the general thread (GENERAL)
  const [chat, setChat] = useState<Record<string, ChatMsg[]>>({})
  const [thinking, setThinking] = useState<Record<string, string>>({}) // thread → 'thinking' | tool name
  const [opened, setOpened] = useState<string | null>(null) // newest incident, for auto-focus
  const ws = useRef<WebSocket | null>(null)
  const seq = useRef(0)

  const log = (kind: FeedItem['kind'], text: string, at = new Date().toISOString(), incidentId?: string) =>
    setFeed((f) => [{ id: seq.current++, at, kind, text, incidentId }, ...f].slice(0, 200))
  const upsert = (inc: Incident) => setIncidents((m) => ({ ...m, [inc.incident_id]: { ...m[inc.incident_id], ...inc } }))
  const settle = (iid: string) => setStages(({ [iid]: _, ...rest }) => rest)
  const say = (thread: string, role: ChatMsg['role'], text: string) =>
    setChat((c) => ({ ...c, [thread]: [...(c[thread] || []), { id: seq.current++, role, text }] }))
  const think = (thread: string, what: string | null) =>
    setThinking(({ [thread]: _, ...rest }) => (what ? { ...rest, [thread]: what } : rest))

  const onEvent = useCallback((e: AuraEvent) => {
    switch (e.type) {
      case 'hello':
        setWatching(e.watching)
        if (e.service) setService(e.service)
        setBeats(e.history || [])
        e.incidents.forEach(upsert)
        break
      case 'heartbeat':
        setBeats((b) => [...b.slice(-179), e as unknown as Beat])
        break
      case 'incident_opened':
        upsert({ incident_id: e.incident_id, status: 'collecting', opened_at: e.at })
        setStages((s) => ({ ...s, [e.incident_id]: 'grouping signals' }))
        setOpened(e.incident_id)
        log('incident', `Incident ${e.incident_id} opened`, e.at, e.incident_id)
        break
      case 'anomaly':
        setIncidents((m) => {
          const inc = m[e.incident_id]
          if (!inc) return m
          return { ...m, [e.incident_id]: { ...inc, anomalies_detected: [...(inc.anomalies_detected || []), e.anomaly] } }
        })
        log('anomaly', `[${e.anomaly.signal_type}] ${e.anomaly.raw_excerpt.split('\n')[0]}${e.late ? ' (late)' : ''}`, e.at, e.incident_id)
        break
      case 'stage':
        setStages((s) => ({ ...s, [e.incident_id]: e.stage }))
        setIncidents((m) => (m[e.incident_id] && ['analyzing', 'executing', 'closing'].includes(e.stage)
          ? { ...m, [e.incident_id]: { ...m[e.incident_id], status: e.stage } } : m))
        log('stage', `${e.stage}${e.detail ? ` — ${e.detail}` : ''}`, e.at, e.incident_id)
        break
      case 'awaiting_approval':
        upsert({ ...e.incident, status: 'awaiting_approval' })
        settle(e.incident.incident_id)
        log('incident', `${e.incident.incident_id} needs your decision`, e.at, e.incident.incident_id)
        break
      case 'action_changed':
      case 'incident':
        if (e.incident) upsert(e.incident)
        if (e.type === 'action_changed') log('stage', `proposed action updated`, e.at, e.incident.incident_id)
        break
      case 'closed': {
        const inc = e.incident as Incident
        upsert(inc)
        settle(inc.incident_id)
        log('closed', `${inc.incident_id} ${inc.status}${inc.execution_result?.message ? ` — ${inc.execution_result.message}` : ''}`, e.at, inc.incident_id)
        break
      }
      case 'thinking':
        think(e.incident_id ?? GENERAL, 'thinking')
        break
      case 'tool':
        think(e.incident_id ?? GENERAL, e.name)
        say(e.incident_id ?? GENERAL, 'tool', `${e.name}(${JSON.stringify(e.args).slice(1, -1).slice(0, 100)})`)
        break
      case 'answer':
        think(e.incident_id ?? GENERAL, null)
        say(e.incident_id ?? GENERAL, 'aura', e.text)
        break
      case 'system':
        log('system', e.text, e.at)
        break
      case 'error':
        log('error', e.message, e.at, e.incident_id)
        break
    }
  }, [])

  useEffect(() => {
    if (!token) return
    let closed = false
    let retry: ReturnType<typeof setTimeout>
    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws'
      const sock = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(token)}`)
      ws.current = sock
      sock.onopen = () => setStatus('connected')
      sock.onmessage = (m) => {
        try { onEvent(JSON.parse(m.data)) } catch { /* ignore malformed frames */ }
      }
      sock.onclose = (ev) => {
        if (closed) return
        setThinking({}) // any answer in flight died with the socket
        if (ev.code === 4401) return setStatus('bad token')
        setStatus('reconnecting')
        retry = setTimeout(connect, 1500)
      }
    }
    setStatus('connecting')
    connect()
    return () => {
      closed = true
      clearTimeout(retry)
      ws.current?.close()
    }
  }, [token, onEvent])

  const send = (msg: object) => {
    if (ws.current?.readyState !== WebSocket.OPEN) return log('error', 'not connected to the Aura server yet')
    ws.current.send(JSON.stringify(msg))
  }

  return {
    status, watching, service, beats, incidents, stages, feed, chat, thinking, opened,
    ask: (text: string, incidentId?: string) => { say(incidentId ?? GENERAL, 'user', text); send({ type: 'chat', text, incident_id: incidentId }) },
    decide: (incidentId: string, decision: 'approved' | 'rejected', note = '') => send({ type: 'decide', incident_id: incidentId, decision, note }),
    load: (incidentId: string) => send({ type: 'get', incident_id: incidentId }),
  }
}
