import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import Logo, { LogoSpinner } from '../components/Logo'
import ThemeToggle from '../components/ThemeToggle'
import Connect from './Connect'
import Markdown from './Markdown'
import MetricTile from './Sparkline'
import Splitter, { usePersisted } from './Splitter'
import { ADVISORY, CLOSED, type Beat, type Incident } from './types'
import { useAura, type Status } from './useAura'

const INVESTIGATE = 'Investigate this incident with your tools (current signals, read-only DB queries such as ' +
  'pg_stat_activity grouped by application_name, logs, recent diffs). Find the concrete cause, then call ' +
  'propose_execution with an executable fix and tell me why.'

// Status is carried by glyph + label + color, so it never depends on color alone.
const STATUS: Record<string, { glyph: string; label: string; tone: string }> = {
  collecting: { glyph: '◌', label: 'Collecting', tone: 'border-sky-400/40 text-sky-300' },
  analyzing: { glyph: '◐', label: 'Analyzing', tone: 'border-violet-400/40 text-violet-300' },
  awaiting_approval: { glyph: '◆', label: 'Needs decision', tone: 'border-amber-400/50 text-amber-300' },
  executing: { glyph: '▶', label: 'Executing', tone: 'border-cyan-400/40 text-cyan-300' },
  closing: { glyph: '▶', label: 'Closing', tone: 'border-cyan-400/40 text-cyan-300' },
  resolved: { glyph: '✓', label: 'Resolved', tone: 'border-emerald-400/40 text-emerald-300' },
  rejected: { glyph: '✕', label: 'Rejected', tone: 'border-red-400/50 text-red-300' },
  unresolved: { glyph: '!', label: 'Unresolved', tone: 'border-red-400/50 text-red-300' },
}

const time = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '')
const pct = (v: number) => `${(v * 100).toFixed(v < 0.01 ? 2 : 1)}%`
const ms = (v: number) => (v < 1 ? `${Math.round(v * 1000)} ms` : `${v.toFixed(2)} s`)

export default function Dashboard() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('aura-token'))
  const aura = useAura(token)

  if (!token || aura.status === 'bad token') {
    return (
      <Connect
        error={token ? 'That token was rejected by the agent server.' : undefined}
        onConnect={(t) => {
          localStorage.setItem('aura-token', t)
          setToken(t)
        }}
      />
    )
  }
  return <Console aura={aura} onSignOut={() => { localStorage.removeItem('aura-token'); setToken(null) }} />
}

function Console({ aura, onSignOut }: { aura: ReturnType<typeof useAura>; onSignOut: () => void }) {
  const list = useMemo(
    () => Object.values(aura.incidents).sort((a, b) => (b.opened_at || '').localeCompare(a.opened_at || '')),
    [aura.incidents],
  )
  const [selected, setSelected] = useState<string | null>(null)
  const focusId = selected ?? list[0]?.incident_id ?? null
  const focus = focusId ? aura.incidents[focusId] : undefined

  // jump to a freshly opened incident
  useEffect(() => { if (aura.opened) setSelected(aura.opened) }, [aura.opened])
  // summary rows from `hello` lack the full RCA/trail; fetch it once when selected
  useEffect(() => { if (focus && !focus.audit_trail && aura.status === 'connected') aura.load(focus.incident_id) }, [focusId, aura.status]) // eslint-disable-line react-hooks/exhaustive-deps

  const beats = aura.beats
  const last = beats.at(-1)
  const times = beats.map((b) => b.at)
  const open = list.filter((i) => !CLOSED.has(i.status)).length

  // resizable columns + chat/feed split (xl only)
  const [left, setLeft] = usePersisted('aura-col-left', 300)
  const [right, setRight] = usePersisted('aura-col-right', 360)
  const [split, setSplit] = usePersisted('aura-chat-split', 0.6)
  const startSize = useRef(0)
  const rightCol = useRef<HTMLDivElement>(null)
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

  return (
    <div className="flex min-h-screen flex-col bg-black text-white xl:h-screen xl:overflow-hidden">
      <header className="sticky top-0 z-40 border-b border-white/10 bg-black/70 backdrop-blur-xl">
        <div className="flex h-16 items-center justify-between px-6">
          <div className="flex items-center gap-6">
            <Logo href="/" />
            <span className="hidden text-sm text-neutral-500 md:inline">Dashboard</span>
          </div>
          <div className="flex items-center gap-4 text-xs">
            <ConnectionPill status={aura.status} />
            {aura.watching && <span className="hidden font-mono text-neutral-500 lg:inline">watching {aura.watching}</span>}
            <ThemeToggle />
            <button onClick={onSignOut} className="text-neutral-500 hover:text-white">Sign out</button>
          </div>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col gap-6 p-6">
        <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <HealthTile health={last?.health} open={open} />
          <MetricTile label="Latency p95" values={beats.map((b) => b.p95)} times={times} format={ms} color="#a78bfa" alert={(v) => v > 1} />
          <MetricTile label="5xx error rate" values={beats.map((b) => b.err)} times={times} format={pct} color="#fb923c" alert={(v) => v > 0.01} />
          <MetricTile label="Requests / s" values={beats.map((b) => b.rps)} times={times} format={(v) => v.toFixed(1)} color="#34d399" />
          <MetricTile label="Memory (RSS)" values={beats.map((b) => b.rss_mb)} times={times} format={(v) => `${Math.round(v)} MB`} color="#22d3ee" />
          <MetricTile
            label={`DB sessions${last?.db.max ? ` / ${last.db.max}` : ''}`}
            values={beats.map((b) => b.db.sessions)}
            times={times}
            format={(v) => `${v}`}
            color="#f472b6"
            alert={(v) => !!last?.db.max && v / last.db.max > 0.8}
          />
        </section>

        <section
          className="grid min-h-0 flex-1 gap-6 xl:grid-cols-[var(--l)_auto_minmax(0,1fr)_auto_var(--r)] xl:gap-0"
          style={{ '--l': `${left}px`, '--r': `${right}px` } as React.CSSProperties}
        >
          <IncidentList list={list} stages={aura.stages} focusId={focusId} onSelect={setSelected} />
          <Splitter
            axis="x"
            onDrag={(d, start) => { if (start) startSize.current = left; else setLeft(clamp(startSize.current + d, 220, 520)) }}
            onReset={() => setLeft(300)}
          />
          {focus ? (
            <IncidentDetail inc={focus} stage={aura.stages[focus.incident_id]} aura={aura} />
          ) : (
            <Empty />
          )}
          <Splitter
            axis="x"
            onDrag={(d, start) => { if (start) startSize.current = right; else setRight(clamp(startSize.current - d, 280, 640)) }}
            onReset={() => setRight(360)}
          />
          <div ref={rightCol} className="flex min-h-0 flex-col gap-6 xl:gap-0">
            <Chat aura={aura} incidentId={focusId ?? undefined} grow={split} />
            <Splitter
              axis="y"
              onDrag={(d, start) => {
                if (start) startSize.current = split
                else setSplit(clamp(startSize.current + d / (rightCol.current?.clientHeight || 1), 0.2, 0.85))
              }}
              onReset={() => setSplit(0.6)}
            />
            <Feed aura={aura} onSelect={setSelected} grow={1 - split} />
          </div>
        </section>
      </main>
    </div>
  )
}

function ConnectionPill({ status }: { status: Status }) {
  const live = status === 'connected'
  return (
    <span className="flex items-center gap-2 rounded-full border border-white/15 px-3 py-1 text-neutral-300">
      <span className={`size-1.5 rounded-full ${live ? 'animate-pulse bg-emerald-400' : status === 'reconnecting' ? 'animate-pulse bg-amber-400' : 'border border-white/60'}`} />
      {live ? 'Live' : status === 'reconnecting' ? 'Reconnecting…' : 'Connecting…'}
    </span>
  )
}

function HealthTile({ health, open }: { health?: Beat['health']; open: number }) {
  const down = health && !health.up
  const tone = open || down ? 'border-red-500/60 bg-red-950/40' : health ? 'border-emerald-500/40 bg-emerald-950/30' : 'border-white/10 bg-neutral-950'
  return (
    <div className={`flex flex-col justify-between rounded-xl border p-4 ${tone}`}>
      <span className="text-xs text-neutral-400">Service</span>
      <div>
        <div className={`text-2xl font-light tracking-tight ${open || down ? 'text-red-300' : health ? 'text-emerald-300' : ''}`}>{open ? `${open} open` : health ? (health.up ? 'Healthy' : 'Down') : '—'}</div>
        <div className="mt-1 text-xs text-neutral-400">{open ? 'incident in progress' : health && !health.up ? `health check: ${health.status}` : 'no open incidents'}</div>
      </div>
    </div>
  )
}

function Panel({ title, children, className = '', right, style }: { title: string; children: React.ReactNode; className?: string; right?: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={style} className={`flex min-h-0 min-w-0 flex-col rounded-2xl border border-white/10 bg-neutral-950 ${className}`}>
      <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
        <h2 className="text-xs font-medium tracking-widest text-neutral-500 uppercase">{title}</h2>
        {right}
      </div>
      {children}
    </div>
  )
}

function StatusBadge({ status, inverted }: { status: string; inverted?: boolean }) {
  const s = STATUS[status] ?? { glyph: '·', label: status, tone: 'border-white/15 text-neutral-300' }
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] ${inverted ? 'border-black/20' : s.tone}`}>
      <span aria-hidden>{s.glyph}</span>
      {s.label}
    </span>
  )
}

function IncidentList({ list, stages, focusId, onSelect }: { list: Incident[]; stages: Record<string, string>; focusId: string | null; onSelect: (id: string) => void }) {
  return (
    <Panel title="Incidents" right={<span className="text-xs text-neutral-600">{list.length}</span>}>
      <div className="max-h-[640px] min-h-0 flex-1 overflow-y-auto p-2 xl:max-h-none">
        {list.length === 0 && <p className="p-4 text-sm text-neutral-500">Nothing yet. Aura is watching.</p>}
        <AnimatePresence initial={false}>
          {list.map((inc) => {
            const active = inc.incident_id === focusId
            const hyp = inc.rca?.hypothesis ?? inc.hypothesis
            return (
              <motion.button
                layout
                key={inc.incident_id}
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                onClick={() => onSelect(inc.incident_id)}
                className={`mb-1 w-full rounded-xl p-3 text-left transition-colors ${active ? 'bg-white text-black' : 'hover:bg-white/5'}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs">{inc.incident_id}</span>
                  <StatusBadge status={inc.status} inverted={active} />
                </div>
                <p className={`mt-2 line-clamp-2 text-sm ${active ? 'text-black/70' : 'text-neutral-400'}`}>
                  {stages[inc.incident_id] ? `${stages[inc.incident_id]}…` : hyp || 'Gathering signals…'}
                </p>
                <div className={`mt-2 text-[11px] ${active ? 'text-black/50' : 'text-neutral-600'}`}>{time(inc.opened_at)}</div>
              </motion.button>
            )
          })}
        </AnimatePresence>
      </div>
    </Panel>
  )
}

function Empty() {
  return (
    <div className="grid min-h-[400px] place-items-center rounded-2xl xl:min-h-0 border border-dashed border-white/10 text-center">
      <div>
        <div className="text-2xl font-light">All quiet.</div>
        <p className="mt-2 text-sm text-neutral-500">Incidents will appear here the moment Aura spots one.</p>
      </div>
    </div>
  )
}

function IncidentDetail({ inc, stage, aura }: { inc: Incident; stage?: string; aura: ReturnType<typeof useAura> }) {
  const rca = inc.rca
  const action = rca?.proposed_action ?? inc.action
  const conf = rca?.calibrated_confidence ?? inc.confidence
  const awaiting = inc.status === 'awaiting_approval'
  const advisory = action ? ADVISORY.has(action.type) : false
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  // set on Investigate click; cleared once Aura finishes its turn (thinking goes back to null)
  const [investigating, setInvestigating] = useState(false)
  const wasThinking = useRef(false)

  useEffect(() => { setRejecting(false); setReason(''); setInvestigating(false) }, [inc.incident_id])
  useEffect(() => {
    if (aura.thinking) wasThinking.current = true
    else if (wasThinking.current) { wasThinking.current = false; setInvestigating(false) }
  }, [aura.thinking])

  return (
    <Panel
      title="Incident"
      right={<span className="font-mono text-xs text-neutral-500">{inc.incident_id}</span>}
    >
      <div className="min-h-0 flex-1 space-y-8 overflow-y-auto p-6">
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge status={inc.status} />
          {stage && (
            <span className="flex items-center gap-2 text-xs text-neutral-400">
              <LogoSpinner className="text-sky-300" />
              {stage}
            </span>
          )}
          {rca?.low_confidence && <span className="rounded-full border border-dashed border-amber-400/60 px-2 py-0.5 text-[11px] text-amber-300">Low confidence</span>}
        </div>

        <div>
          <div className="text-xs text-neutral-500">Hypothesis</div>
          <p className="mt-2 text-2xl leading-snug font-light tracking-tight">{rca?.hypothesis ?? inc.hypothesis ?? 'Still analyzing…'}</p>
          {rca?.root_cause_type && <div className="mt-3 font-mono text-xs text-neutral-500">{rca.root_cause_type}</div>}
        </div>

        {typeof conf === 'number' && (
          <div>
            <div className="flex justify-between text-xs text-neutral-500">
              <span>Confidence</span>
              <span className="font-mono text-white">{conf.toFixed(2)}</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
              <motion.div className={`h-full rounded-full ${conf >= 0.7 ? 'bg-emerald-400' : conf >= 0.4 ? 'bg-amber-400' : 'bg-red-400'}`} initial={{ width: 0 }} animate={{ width: `${conf * 100}%` }} transition={{ duration: 0.8 }} />
            </div>
            {!!rca?.confidence_adjustments?.length && (
              <ul className="mt-3 space-y-1 font-mono text-[11px] text-neutral-500">
                {rca.confidence_adjustments.map((a, i) => <li key={i}>{a}</li>)}
              </ul>
            )}
          </div>
        )}

        {!!rca?.evidence?.length && (
          <div>
            <div className="text-xs text-neutral-500">Evidence</div>
            <ul className="mt-3 space-y-2">
              {rca.evidence.map((e, i) => (
                <li key={i} className="flex gap-3 rounded-lg border border-white/10 p-3 text-sm">
                  <span className="shrink-0 font-mono text-[11px] text-neutral-500 uppercase">{e.source}</span>
                  <span className="text-neutral-300">{e.detail}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {action && (
          <div className={`rounded-xl border p-5 ${awaiting ? 'border-amber-400/60 bg-amber-950/20' : 'border-white/10'}`}>
            <div className="text-xs text-neutral-500">{advisory ? 'Suggested next step' : 'Proposed action'}</div>
            <div className="mt-2 font-mono text-lg break-all">
              {action.type} <span className="text-neutral-500">→</span> {action.target}
            </div>
            {awaiting && (
              <div className="mt-5">
                {rejecting ? (
                  <form
                    className="flex flex-col gap-2 sm:flex-row"
                    onSubmit={(e) => {
                      e.preventDefault()
                      if (!reason.trim()) return
                      aura.decide(inc.incident_id, 'rejected', reason.trim())
                      setRejecting(false)
                    }}
                  >
                    <input
                      autoFocus
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="Why is this wrong? (stored as negative memory)"
                      className="flex-1 rounded-full border border-white/20 bg-black px-4 py-2 text-sm outline-none focus:border-white/60"
                    />
                    <button disabled={!reason.trim()} className="rounded-full bg-red-500 px-5 py-2 text-sm font-medium text-white disabled:opacity-40">Reject</button>
                    <button type="button" onClick={() => setRejecting(false)} className="px-3 text-sm text-neutral-500 hover:text-white">Cancel</button>
                  </form>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {advisory && investigating ? (
                      <span className="flex items-center gap-2 px-1 py-2 text-sm text-sky-300">
                        <LogoSpinner size={16} />
                        Investigating…
                      </span>
                    ) : advisory ? (
                      <button
                        onClick={() => { wasThinking.current = false; setInvestigating(true); aura.ask(INVESTIGATE, inc.incident_id) }}
                        className="rounded-full bg-white px-5 py-2 text-sm font-medium text-black hover:opacity-85"
                      >
                        Investigate
                      </button>
                    ) : (
                      <button onClick={() => aura.decide(inc.incident_id, 'approved')} className="rounded-full bg-emerald-400 px-5 py-2 text-sm font-medium text-black hover:opacity-85">
                        Approve
                      </button>
                    )}
                    <button onClick={() => setRejecting(true)} className="rounded-full border border-red-400/40 px-5 py-2 text-sm text-red-300 hover:bg-red-500/10">
                      Reject…
                    </button>
                  </div>
                )}
              </div>
            )}
            {inc.execution_result?.message && <p className={`mt-4 text-sm ${inc.status === 'resolved' ? 'text-emerald-300' : inc.status === 'unresolved' ? 'text-red-300' : 'text-neutral-300'}`}>{inc.execution_result.message}</p>}
            {inc.human_note && <p className="mt-2 text-sm text-neutral-500">Note: “{inc.human_note}”</p>}
          </div>
        )}

        {!!inc.anomalies_detected?.length && (
          <div>
            <div className="text-xs text-neutral-500">Anomalies ({inc.anomalies_detected.length})</div>
            <ul className="mt-3 space-y-1.5 font-mono text-xs text-neutral-400">
              {inc.anomalies_detected.map((a) => (
                <li key={a.id} className="truncate"><span className="text-amber-400/80">[{a.signal_type}]</span> {a.raw_excerpt.split('\n')[0]}</li>
              ))}
            </ul>
          </div>
        )}

        {!!inc.audit_trail?.length && (
          <div>
            <div className="text-xs text-neutral-500">Timeline</div>
            <ol className="relative mt-4 space-y-4 border-l border-white/10 pl-5">
              {inc.audit_trail.map((a, i) => (
                <li key={i} className="relative">
                  <span className="absolute top-1.5 -left-[23px] size-[7px] rounded-full border border-white/60 bg-black" />
                  <div className="flex gap-3 text-xs">
                    <span className="font-mono text-neutral-600">{time(a.timestamp)}</span>
                    <span className="font-medium">{a.node}</span>
                  </div>
                  <p className="mt-1 text-sm text-neutral-400">{a.output_summary}</p>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </Panel>
  )
}

function Chat({ aura, incidentId, grow }: { aura: ReturnType<typeof useAura>; incidentId?: string; grow: number }) {
  const [text, setText] = useState('')
  const box = useRef<HTMLDivElement>(null)
  // keep the newest message in view without scrolling the page itself
  useEffect(() => { if (box.current) box.current.scrollTop = box.current.scrollHeight }, [aura.chat.length, aura.thinking])

  return (
    <Panel className="xl:min-h-0 xl:basis-0" style={{ flexGrow: grow }} title="Ask Aura" right={incidentId && <span className="font-mono text-[11px] text-neutral-600">{incidentId}</span>}>
      <div ref={box} className="h-72 min-h-0 space-y-3 overflow-y-auto p-4 text-sm xl:h-auto xl:flex-1">
        {aura.chat.length === 0 && <p className="text-neutral-500">Ask why, what changed, or what happened last time.</p>}
        {aura.chat.map((m) =>
          m.role === 'tool' ? (
            <div key={m.id} className="truncate font-mono text-[11px] text-neutral-600">⏺ {m.text}</div>
          ) : (
            m.role === 'user' ? (
              <div key={m.id} className="ml-8 rounded-2xl rounded-br-sm bg-white px-4 py-2 whitespace-pre-wrap text-black">{m.text}</div>
            ) : (
              <div key={m.id} className="mr-2 break-words text-neutral-300"><Markdown text={m.text} /></div>
            )
          ),
        )}
        {aura.thinking && (
          <div className="flex items-center gap-2 text-xs text-neutral-500">
            <LogoSpinner size={16} className="text-sky-300" />
            {aura.thinking === 'thinking' ? 'Aura is thinking' : aura.thinking}
          </div>
        )}
      </div>
      <form
        className="border-t border-white/10 p-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (!text.trim()) return
          aura.ask(text.trim(), incidentId)
          setText('')
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Message Aura…"
          className="w-full rounded-full border border-white/15 bg-black px-4 py-2 text-sm outline-none placeholder:text-neutral-600 focus:border-white/50"
        />
      </form>
    </Panel>
  )
}

function Feed({ aura, onSelect, grow }: { aura: ReturnType<typeof useAura>; onSelect: (id: string) => void; grow: number }) {
  const glyph = { incident: '●', anomaly: '▲', stage: '⎿', closed: '■', error: '✕', system: '·' }
  const tone = { incident: 'text-red-300', anomaly: 'text-amber-300', stage: 'text-neutral-500', closed: 'text-emerald-300', error: 'text-red-400', system: 'text-neutral-500' }
  return (
    <Panel className="xl:min-h-0 xl:basis-0" style={{ flexGrow: grow }} title="Live feed">
      <div className="max-h-80 min-h-0 flex-1 overflow-y-auto p-3 font-mono text-[11px] leading-relaxed xl:max-h-none">
        {aura.feed.length === 0 && <p className="p-2 text-neutral-500">Waiting for events…</p>}
        {aura.feed.map((f) => (
          <button
            key={f.id}
            onClick={() => f.incidentId && onSelect(f.incidentId)}
            className={`flex w-full gap-2 rounded px-2 py-0.5 text-left hover:bg-white/5 ${tone[f.kind]} ${f.kind === 'error' ? 'bg-red-500/10' : ''}`}
          >
            <span className="shrink-0 text-neutral-600">{time(f.at)}</span>
            <span className="shrink-0">{glyph[f.kind]}</span>
            <span className="truncate">{f.text}</span>
          </button>
        ))}
      </div>
    </Panel>
  )
}
